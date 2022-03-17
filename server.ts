import { getRandomColor } from "./helpers.ts";

const server = Deno.listen({ hostname: "0.0.0.0", port: 8080 });

class ChatUser {
  uuid: string;
  username: string;
  color: string;
  conn: WebSocket;

  constructor(uuid: string, username: string, conn: WebSocket) {
    this.uuid = uuid;
    this.username = username;
    this.conn = conn;
    this.color = getRandomColor();
  }
}

type ConnPool = {
  [key: string]: ChatUser;
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
    const { id, message, username, datetime } = JSON.parse(e.data);
    const userExists = connectionPool[id];
    if (!userExists) {
      connectionPool[id] = new ChatUser(id, username, socket);
    }
    Object.keys(connectionPool).forEach((id) => {
      const user = connectionPool[id];
      user.conn.send(
        JSON.stringify({
          datetime,
          username,
          id,
          message,
          color: user.color,
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
