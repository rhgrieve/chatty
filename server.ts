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

  broadcast(message: string) {
    this.conn.readyState === 1 && this.conn.send(JSON.stringify({
      message,
      datetime: new Date().toLocaleTimeString(),
      id: this.uuid,
      username: this.username,
      color: this.color,
    }));
  }
}

class ConnPool {
  connections: { [key: string]: ChatUser };

  constructor() {
    this.connections = {};
  }

  getConnectionByID(id: string): ChatUser | null {
    return this.connections[id];
  }

  addConnection(user: ChatUser) {
    this.connections[user.uuid] = user;
    return user;
  }

  getActiveCount() {
    return Object.keys(this.connections).filter((key) =>
      this.connections[key].conn.readyState === 1
    ).length;
  }

  getAllConnections() {
    return Object.keys(this.connections).map((key) => this.connections[key]);
  }
}

const connectionPool = new ConnPool();

function broadcastMessage(
  user: ChatUser,
  datetime: string,
  username: string,
  id: string,
  message: string,
  color: string,
) {
  user.conn.readyState === 1 && user.conn.send(JSON.stringify({
    datetime,
    username,
    id,
    message,
    color,
  }));
}

function onMessage(this: WebSocket, e: MessageEvent<any>): any {
  console.log("socket message:", e.data);

  const { id, message, username, statusMessage } = JSON.parse(e.data);
  let sendingUser = connectionPool.getConnectionByID(id);
  if (!sendingUser) {
    sendingUser = connectionPool.addConnection(
      new ChatUser(id, username, this),
    );
  }

  if (statusMessage === "connect") {
    connectionPool.getAllConnections().forEach((user) => {
      user.broadcast("connected to chat");
    });
  } else if (statusMessage === "disconnect") {
    connectionPool.getAllConnections().forEach((user) => {
      user.broadcast("left the chat");
    });
  } else {
    connectionPool.getAllConnections().forEach((user) => {
      user.broadcast(message);
    });
  }
}

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

  socket.onmessage = onMessage;

  socket.onerror = (e) =>
    console.log("socket error:", (<ErrorEvent> e).message);
  socket.onclose = () => console.log("socket closed");
  return response;
}

for await (const conn of server) {
  handle(conn);
}
