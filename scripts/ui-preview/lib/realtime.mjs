/**
 * Silent Supabase Realtime (Phoenix protocol, vsn 1.0.0) over a hand-rolled
 * WebSocket — node:http only, no deps.
 *
 * Every `phx_join` is acknowledged with the client's own postgres_changes
 * bindings echoed back (with ids), so realtime-js reports SUBSCRIBED instead
 * of CHANNEL_ERROR / TIMED_OUT. Heartbeats are answered. No change events are
 * ever pushed: the screens stay still for screenshots.
 */
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeFrame(text, opcode = 0x1) {
  const payload = Buffer.from(text);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Parse as many complete frames as `buf` holds. Returns { frames, rest }. */
function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let pos = off + 2;
    if (len === 126) {
      if (buf.length - pos < 2) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (buf.length - pos < 8) break;
      len = Number(buf.readBigUInt64BE(pos));
      pos += 8;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length - pos < maskLen + len) break;
    const mask = masked ? buf.subarray(pos, pos + 4) : null;
    pos += maskLen;
    const data = Buffer.from(buf.subarray(pos, pos + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    frames.push({ opcode, data });
    off = pos + len;
  }
  return { frames, rest: buf.subarray(off) };
}

export function handleRealtimeUpgrade(req, socket, log) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  log?.("realtime: connected");

  let pending = Buffer.alloc(0);
  const send = (obj) => {
    if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(obj)));
  };

  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    const { frames, rest } = decodeFrames(pending);
    pending = rest;
    for (const f of frames) {
      if (f.opcode === 0x8) {
        // close
        if (!socket.destroyed) socket.end(encodeFrame("", 0x8));
        return;
      }
      if (f.opcode === 0x9) {
        socket.write(encodeFrame(f.data.toString(), 0xa)); // pong
        continue;
      }
      if (f.opcode !== 0x1) continue;
      let msg;
      try {
        msg = JSON.parse(f.data.toString());
      } catch {
        continue;
      }
      const { topic, event, payload, ref, join_ref } = msg;
      if (event === "phx_join") {
        const pc = payload?.config?.postgres_changes ?? [];
        send({
          topic,
          event: "phx_reply",
          payload: {
            status: "ok",
            response: { postgres_changes: pc.map((b, i) => ({ ...b, id: 1000 + i })) },
          },
          ref,
          join_ref: join_ref ?? ref,
        });
        send({ topic, event: "system", payload: { status: "ok", message: "Subscribed to PostgreSQL", extension: "postgres_changes", channel: topic.replace(/^realtime:/, "") }, ref: null });
      } else if (ref != null) {
        // heartbeat, phx_leave, access_token, broadcast with ack, presence…
        send({ topic, event: "phx_reply", payload: { status: "ok", response: {} }, ref, join_ref });
      }
    }
  });
  socket.on("error", () => socket.destroy());
}
