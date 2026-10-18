import dgram from "node:dgram";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PERSONA_STUN_PORT || 34780);
const HOST = "127.0.0.1";
const MAGIC_COOKIE = 0x2112a442;

function getExitIpv4() {
  let raw = (process.env.PERSONA_EXIT_IP || "").trim();
  if (!raw) {
    try {
      raw = readFileSync("/tmp/persona_exit_ip", "utf8").trim();
    } catch {
      raw = "";
    }
  }
  const parts = raw.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

const server = dgram.createSocket("udp4");

server.on("message", (msg, rinfo) => {
  if (msg.length < 20) return;
  const msgType = msg.readUInt16BE(0);
  const cookie = msg.readUInt32BE(4);
  // RFC 5389 Binding Request (0x0001)
  if (msgType !== 0x0001 || cookie !== MAGIC_COOKIE) return;

  const ipUint32 = getExitIpv4();
  if (ipUint32 === null) return;

  const res = Buffer.alloc(32);
  // Binding Success Response (0x0101), body length 12 bytes
  res.writeUInt16BE(0x0101, 0);
  res.writeUInt16BE(12, 2);
  res.writeUInt32BE(MAGIC_COOKIE, 4);
  // Echo 12-byte transaction ID
  msg.copy(res, 8, 8, 20);

  // Attribute: XOR-MAPPED-ADDRESS (0x0020), length 8
  res.writeUInt16BE(0x0020, 20);
  res.writeUInt16BE(8, 22);
  res.writeUInt8(0x00, 24); // Reserved
  res.writeUInt8(0x01, 25); // Family: IPv4 (0x01)
  res.writeUInt16BE((rinfo.port ^ (MAGIC_COOKIE >>> 16)) & 0xffff, 26);
  res.writeUInt32BE((ipUint32 ^ MAGIC_COOKIE) >>> 0, 28);

  server.send(res, rinfo.port, rinfo.address);
});

server.bind(PORT, HOST, () => {
  process.stdout.write(`Local STUN responder listening on ${HOST}:${PORT}\n`);
});

function shutdown() {
  try {
    server.close();
  } catch {
    // ignore
  }
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
