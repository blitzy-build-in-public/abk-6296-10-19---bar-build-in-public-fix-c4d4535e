# Node.js HTTP Server Tutorial: Hello World

A minimal, single-file Node.js HTTP server built on the built-in `http` module, with no framework, no middleware, no router and no dependencies. It is a reference implementation for beginners who want to see how the built-in module turns an incoming request into a response.

## Prerequisites

- **Node.js 18 or newer.** `package.json` declares `">=18.0.0"` in `engines.node`, and Node 18 is the floor because every API the server uses exists there.

## Installation

Nothing to install. The Node.js runtime and the three files of this project (`server.js`, `package.json` and this `README.md`) are the whole project: it declares no dependencies and imports only the built-in `http` module.

## Running the server

From the project directory, run either:

```bash
node server.js
```

```bash
npm start
```

`npm start` runs the same command, taken from the `"start": "node server.js"` script in `package.json`.

The server runs in the foreground and prints a startup line once it is listening:

```text
Server listening on port 3000
```

The number in that line is the resolved port — `3000` by default, or the value of `PORT` (see [Port configuration](#port-configuration)).

## Testing the endpoints

The server has one route and one catch-all:

| Request | Status | Content-Type | Body |
| --- | --- | --- | --- |
| `GET /hello` | `200` | `text/plain` | `Hello world` |
| any other method or path | `404` | `text/plain` | `Not Found` |

The match covers the method as well as the path, so a request has to be a `GET` **and** target `/hello`:

- `GET /hello` → `200` with `Hello world`
- `POST /hello`, `HEAD /hello` → `404` with `Not Found`, because the method is part of the match
- `/hello?x=1` → `200` with `Hello world`, because a query string is not part of the path
- `/hello/`, `/Hello`, `/%68ello` → `404` with `Not Found`, because a trailing slash, a different case and percent-encoding are not normalised

With the server running, these three commands exercise all of it:

```bash
# the one matched route
curl -s -i http://localhost:3000/hello

# the catch-all
curl -s -i http://localhost:3000/not-a-route

# a method mismatch: still the catch-all
curl -s -i -X POST http://localhost:3000/hello
```

## Expected output

**stdout** carries operator events: the startup line, one line per request, and the two shutdown lines. **stderr** carries problems: a configuration error, a port that cannot be bound, an unexpected server error, an unexpected request error or a client socket error on a `CONNECT` request. A configuration error, a bind failure or any other fatal server error exits with status `1`; a clean shutdown exits with status `0`.

### Startup

```text
Server listening on port 3000
```

### `curl -s -i http://localhost:3000/hello`

```text
HTTP/1.1 200 OK
Content-Type: text/plain
Content-Length: 11
Date: Mon, 19 Oct 2026 20:43:18 GMT
Connection: keep-alive
Keep-Alive: timeout=5

Hello world
```

### `curl -s -i http://localhost:3000/not-a-route`

```text
HTTP/1.1 404 Not Found
Content-Type: text/plain
Content-Length: 9
Date: Mon, 19 Oct 2026 20:43:18 GMT
Connection: keep-alive
Keep-Alive: timeout=5

Not Found
```

`curl -s -i -X POST http://localhost:3000/hello` returns the same 404 response. `curl -s -I http://localhost:3000/hello` returns the same 404 status and headers with the body omitted, because the response to a `HEAD` request carries no body.

Only `Content-Type` and `Content-Length` are set by the application; `Date`, `Connection` and `Keep-Alive` are added by Node. The content length is always exact, so a response is never sent with `Transfer-Encoding: chunked`.

### Request log line (stdout)

Each request the server handles adds exactly one line to stdout, written before the response:

```text
2026-10-19T20:43:18.803Z GET /hello
```

The three fields are the timestamp from `Date.prototype.toISOString()` (UTC, ISO-8601, with milliseconds), the HTTP method, and the request path the server routed on. Nothing else is logged per request — no headers, no cookies and no query strings — for any target the server can parse; a target the URL parser rejects has no pathname to route on, so it is logged as received, query string included. A request the runtime rejects before the listener runs is not logged by the application at all.

### Configuration error (stderr, exit status 1)

```bash
PORT=abc node server.js; echo "exit=$?"
```

```text
Configuration error: invalid PORT "abc". Set PORT to an integer between 1024 and 65535.
exit=1
```

### Shutdown (stdout, exit status 0)

```text
Received SIGINT. Stopping server.
Server closed. Exiting.
```

## Shutdown

Press CTRL+C while the server runs in the foreground. It prints:

```text
Received SIGINT. Stopping server.
Server closed. Exiting.
```

The prompt then returns with exit status `0`, and the port is free again for the next run. From another shell, the same shutdown is `kill -INT` sent to the server's process id — `$!` when you started it with `node server.js &`. Under `npm start &` that pid is npm's, and a `SIGINT` sent to npm alone is not forwarded, so signal the `node` child itself, or start the server with `node server.js &` when you need to signal it from another shell.

CTRL+C more than once is harmless: the shutdown runs only once, and a second signal changes nothing. One runtime detail is worth knowing: on Node 18.0 and 18.1, if a client is still holding an idle keep-alive connection, the `Server closed. Exiting.` line appears when that connection's keep-alive window expires (up to about five seconds) rather than immediately — a Node version difference, not a hang. Newer runtimes close idle connections at once.

## Port configuration

| `PORT` | Behaviour |
| --- | --- |
| unset | `3000` |
| `1024`–`65535` | that port is used |
| anything else | configuration error on stderr, exit `1`, nothing bound |

- The default applies only when `PORT` is unset. An empty `PORT` is an invalid value, not the default.
- Only whole numbers are accepted, from `1024` to `65535` inclusive.
- Values below `1024` are refused in the configuration check, before any socket call is made, because such ports are privileged. No flag or variable bypasses this check.

Use another port by setting the variable for that run:

The command form below is POSIX shell syntax; on Windows the same override is `set "PORT=4000" && node server.js` in cmd.exe (the quotes keep the space before `&&` out of the value), or `$env:PORT=4000; node server.js` in PowerShell. Only that override form and the `; echo "exit=$?"` used below to print an exit status are shell-specific: the default `3000`, the accepted `1024`–`65535` range, the privileged-port refusal and every message shown are the same on every platform.

```bash
PORT=4000 node server.js
```

```text
Server listening on port 4000
```

```bash
curl -s -i http://localhost:4000/hello
```

returns the `200` response shown above.

Refused values are reported on stderr, exit with status `1`, and bind nothing:

```bash
PORT=80 node server.js; echo "exit=$?"
```

```text
Configuration error: invalid PORT "80". Ports below 1024 are privileged and require root or CAP_NET_BIND_SERVICE; set PORT to an integer between 1024 and 65535.
exit=1
```

```bash
PORT=abc node server.js; echo "exit=$?"
```

```text
Configuration error: invalid PORT "abc". Set PORT to an integer between 1024 and 65535.
exit=1
```

The second message is also what `PORT=70000`, `PORT=65536`, `PORT=3000.5`, `PORT=8e3` and an empty `PORT` produce.

If the port is already in use, the bind attempt fails and the message names the port it tried to bind:

```bash
PORT=4000 node server.js; echo "exit=$?"   # while another instance is listening on 4000
```

```text
Error: cannot bind to port 4000 (EADDRINUSE: address already in use). Stop the process using that port or set PORT to a different port.
exit=1
```

`server.listen(port)` is called without a host argument, so the server accepts connections on all interfaces of the machine, as Node does by default. `PORT` is the only setting it reads.
