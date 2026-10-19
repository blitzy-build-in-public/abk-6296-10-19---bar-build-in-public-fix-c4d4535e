"use strict";

const http = require("node:http");

// Every literal the program uses is defined here, once, and used from here everywhere.
const DEFAULT_PORT = 3000;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const HELLO_METHOD = "GET";
const HELLO_PATH = "/hello";
const HELLO_BODY = "Hello world";
const NOT_FOUND_BODY = "Not Found";
const SERVER_ERROR_BODY = "Internal Server Error";
// Request targets are resolved against this fixed base, never against the client-supplied
// Host header, so a caller cannot influence the parsed authority or the routing key.
const URL_BASE = "http://localhost";
const PLAIN_TEXT = "text/plain";
// A configured value that reaches a diagnostic must not be able to break it across lines or
// forge an entry in a captured log, so C0 controls, DEL, C1 controls and the Unicode line and
// paragraph separators are all treated as non-printing.
const NON_PRINTING_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

// Attaching a SIGINT listener replaces Node's default handler, so the process has to end
// itself and a repeated signal must not start a second shutdown.
let isStopping = false;

// Replaces every non-printing character in a value that is about to be echoed, so a crafted
// PORT cannot split one diagnostic across lines or forge a line in a captured log.
function neutralizeControlCharacters(value) {
  return value.replace(NON_PRINTING_CHARACTERS, "?");
}

// Turns process.env.PORT into a usable port number, or throws an Error whose message names
// the offending value, the cause and the action to take.
function resolvePort(rawPort) {
  if (rawPort === undefined) {
    return DEFAULT_PORT;
  }

  const isIntegerString = /^\d+$/.test(rawPort);
  const port = isIntegerString ? Number.parseInt(rawPort, 10) : Number.NaN;

  if (isIntegerString && port >= MIN_PORT && port <= MAX_PORT) {
    return port;
  }

  // Ports below the floor are refused here, before any socket call, so the process can
  // never occupy a privileged port.
  if (isIntegerString && port < MIN_PORT) {
    throw new Error(
      'Configuration error: invalid PORT "' +
        neutralizeControlCharacters(rawPort) +
        '". Ports below ' +
        MIN_PORT +
        " are privileged and require root or CAP_NET_BIND_SERVICE; set PORT to an integer between " +
        MIN_PORT +
        " and " +
        MAX_PORT +
        "."
    );
  }

  throw new Error(
    'Configuration error: invalid PORT "' +
      neutralizeControlCharacters(rawPort) +
      '". Set PORT to an integer between ' +
      MIN_PORT +
      " and " +
      MAX_PORT +
      "."
  );
}

// Extracts the pathname from the request target, returning null when the parser rejects it.
function parsePathname(requestTarget) {
  try {
    return new URL(requestTarget, URL_BASE).pathname;
  } catch {
    // A target that cannot be parsed has no pathname to route on; the catch-all answers it.
    return null;
  }
}

// Emits the single log line for one request: ISO-8601 timestamp, HTTP method, request path.
function logRequest(method, pathname) {
  console.log(new Date().toISOString() + " " + method + " " + pathname);
}

// The one write point for every response: status, content type, byte-exact length, body.
function sendPlainText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": PLAIN_TEXT,
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

// Routes one request: parse the target, log the request, then dispatch to the handler for
// the matched route or to the catch-all.
function handleRequest(request, response) {
  // No application code reads or inspects a request body: this discards whatever a client
  // sends, so nothing about a body is parsed, logged or kept, and a body is consumed as it
  // arrives rather than left for the runtime to discard once the response is out. Consuming
  // one still moves resident memory while each chunk is read off the wire and dropped: the
  // runtime's per-read buffers, which garbage collection reclaims, plus the allocator's
  // high-water mark, which it need not. None of it is state this program keeps.
  request.resume();

  const pathname = parsePathname(request.url);

  // The logged path is the one the router matches on, and the log call precedes the
  // routing decision, so log and behaviour cannot disagree.
  logRequest(request.method, pathname === null ? request.url : pathname);

  if (request.method === HELLO_METHOD && pathname === HELLO_PATH) {
    handleHello(request, response);
    return;
  }

  handleNotFound(request, response);
}

// GET /hello responds 200 text/plain with the fixed hello body.
function handleHello(request, response) {
  sendPlainText(response, 200, HELLO_BODY);
}

// The catch-all for every other method and path responds 404 text/plain.
function handleNotFound(request, response) {
  sendPlainText(response, 404, NOT_FOUND_BODY);
}

// Keeps the process alive when handling a request fails, while the client receives no
// internal detail beyond a constant body.
function requestListener(request, response) {
  try {
    handleRequest(request, response);
  } catch (error) {
    // stderr is the only sink for internal detail.
    console.error("Request error: " + (error.stack || error.message));

    if (response.headersSent) {
      response.destroy();
      return;
    }

    sendPlainText(response, 500, SERVER_ERROR_BODY);
  }
}

// A CONNECT request arrives as a bare socket instead of the request/response pair a 'request'
// event carries, and with no 'connect' listener the runtime closes the connection without a
// reply, so the catch-all answer goes to that socket directly.
function connectListener(request, clientSocket) {
  const pathname = parsePathname(request.url);

  // The logged path is the one the router would match on, exactly as in handleRequest.
  logRequest(request.method, pathname === null ? request.url : pathname);

  // The runtime detaches its own socket listeners when it hands a CONNECT request over, so a
  // client that vanishes mid-answer would otherwise raise an unhandled 'error' event and stop
  // the process; the socket is destroyed instead and nothing further is written to the client.
  clientSocket.on("error", function onClientSocketError(error) {
    console.error("Client socket error: " + (error.code || error.message));
    clientSocket.destroy();
  });

  clientSocket.end(
    "HTTP/1.1 404 Not Found\r\nContent-Type: " +
      PLAIN_TEXT +
      "\r\nContent-Length: " +
      Buffer.byteLength(NOT_FOUND_BODY) +
      "\r\n\r\n" +
      NOT_FOUND_BODY
  );
}

// Stops the server exactly once: announce the signal, close the listener, then exit 0.
function stopServer(server) {
  if (isStopping) {
    return;
  }

  isStopping = true;

  console.log("Received SIGINT. Stopping server.");

  server.close(function onClosed() {
    console.log("Server closed. Exiting.");
    process.exit(0);
  });

  // closeIdleConnections() arrived in v18.2.0, so on the 18.0/18.1 branch of the supported
  // range it does not exist and an idle keep-alive client is instead released when its
  // keep-alive window expires.
  if (typeof server.closeIdleConnections === "function") {
    server.closeIdleConnections();
  }
}

// Creates the server, attaches its error and connect listeners, starts listening and
// registers the shutdown handler, in that order.
function startServer(port) {
  const server = http.createServer(requestListener);

  // An emitted 'error' with no listener would throw and kill the process, so this listener
  // is attached before listen() and reports the cause instead.
  server.on("error", function onServerError(error) {
    if (error.code === "EADDRINUSE") {
      console.error(
        "Error: cannot bind to port " +
          port +
          " (EADDRINUSE: address already in use). Stop the process using that port or set PORT to a different port."
      );
      process.exit(1);
    } else {
      console.error("Server error: " + (error.code || error.message));
      process.exit(1);
    }
  });

  server.on("connect", connectListener);

  server.listen(port, function onListening() {
    console.log("Server listening on port " + port);
  });

  process.on("SIGINT", function onSigint() {
    stopServer(server);
  });
}

// Resolves the configured port and starts the server, reporting a configuration error and
// exiting 1 when the port is invalid.
function main() {
  let port;

  try {
    port = resolvePort(process.env.PORT);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
    // process.exit() ends the process; the return keeps an intercepted exit harmless.
    return;
  }

  startServer(port);
}

main();
