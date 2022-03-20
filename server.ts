import { getRandomColor } from "./helpers.ts";

const server = Deno.listen({ hostname: "0.0.0.0", port: 8080 });

interface MessageData {
  id: string;
  message: string;
  username: string;
  datetime: string;
  color: string;
  statusMessage?: string;
  isSystem?: boolean;
}

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
class ConnPool {
  connections: { [key: string]: ChatUser };

  constructor() {
    this.connections = {};
  }

  broadcast(message: string, sendingUser: ChatUser, isSystem?: boolean) {
    const deliveryUsers = isSystem
      ? this.getAllConnections().filter((user) =>
        user.uuid !== sendingUser.uuid
      )
      : this.getAllConnections();
    deliveryUsers.forEach((user) => {
      user.conn.readyState === 1 && user.conn.send(JSON.stringify({
        message,
        datetime: new Date().toLocaleTimeString(),
        id: sendingUser.uuid,
        username: sendingUser.username,
        color: sendingUser.color,
        isSystem,
      }));
    });
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

  removeUserFromPool(user: ChatUser) {
    delete this.connections[user.uuid];
  }

  getFirstDeadConnection() {
    const firstInactive =
      this.getAllConnections().filter((user) =>
        user.conn.readyState === WebSocket.CLOSED
      )[0];
    this.removeUserFromPool(firstInactive);
    return firstInactive;
  }

  sendToUser(user: ChatUser, message: string) {
    connectionPool.getConnectionByID(user.uuid)?.conn.send(JSON.stringify({
      message,
      datetime: new Date().toLocaleTimeString(),
      isSystem: true,
    }));
  }
}

const connectionPool = new ConnPool();

function parseCommand(command: string): string {
  switch (command) {
    case "help":
      return "Available commands: `help`, `active`";
    case "active":
      return `(${connectionPool.getActiveCount()}) ` +
        connectionPool.getAllConnections().map((user) => user.username)
          .join(", ");
    default:
      return `Command not found: ${command}`;
  }
}

function onMessage(this: WebSocket, e: MessageEvent<any>): any {
  console.log("socket message:", e.data);

  const { id, message, username, statusMessage } = <MessageData> JSON.parse(
    e.data,
  );
  let sendingUser = connectionPool.getConnectionByID(id);
  if (!sendingUser) {
    sendingUser = connectionPool.addConnection(
      new ChatUser(id, username, this),
    );
  }

  if (message.startsWith(">")) {
    const command = message.substring(1);
    connectionPool.sendToUser(sendingUser, parseCommand(command));
    return;
  }

  switch (statusMessage) {
    case "connect":
      connectionPool.broadcast(
        `:wave: ${sendingUser.username} has entered the chat`,
        sendingUser,
        true,
      );
      break;
    case "disconnect":
      connectionPool.broadcast(
        `:v: ${sendingUser.username} has left the chat`,
        sendingUser,
        true,
      );
      break;
    default:
      connectionPool.broadcast(message, sendingUser);
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

  socket.onclose = () => {
    console.log("socket closed");
    const userLeft = connectionPool.getFirstDeadConnection();
    connectionPool.broadcast(
      `:v: ${userLeft.username} has left the chat`,
      userLeft,
      true,
    );
  };
  return response;
}

for await (const conn of server) {
  handle(conn);
}
