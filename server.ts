import { getRandomColor } from "./helpers.ts";

const server = Deno.listen({ hostname: "0.0.0.0", port: 8080 });

interface ChatUser {
  id: number;
  conn: WebSocket;
}

type ConnPool = {
  [key: string]: WebSocket;
};
const connectionPool: ConnPool = {};

async function handle(conn: Deno.Conn) {
  const httpConn = Deno.serveHttp(conn);
  for await (const requestEvent of httpConn) {
    await requestEvent.respondWith(handleReq(requestEvent.request));
  }
}

function handleReq(req: Request): Response {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() != "websocket") {
    return new Response("request isn't trying to upgrade to websocket");
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  socket.onopen = () => {
    console.log("socket opened");
  };
  socket.onmessage = (e) => {
    console.log("socket message:", e.data);
    const { id, message, datetime } = JSON.parse(e.data);
    connectionPool[id] = socket;
    Object.keys(connectionPool).forEach((id) => {
      connectionPool[id].send(
        JSON.stringify({
          datetime,
          id,
          message,
        }),
      );
    });
  };
  socket.onerror = (e) =>
    console.log("socket error:", (<ErrorEvent> e).message);
  socket.onclose = () => console.log("socket closed");
  return response;
}

for await (const conn of server) {
  handle(conn);
}
