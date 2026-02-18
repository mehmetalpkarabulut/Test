const http = require("http");
const fs = require("fs");
const path = require("path");
const { createClient } = require("redis");
const sql = require("mssql");

const PORT = Number(process.env.PORT || 3000);

function loadAppSettings() {
  const p = path.join(__dirname, "appsettings.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return { ConnectionStrings: {} };
  }
}

const settings = loadAppSettings();
const redisConn =
  process.env.ConnectionStrings__Redis ||
  (settings.ConnectionStrings && settings.ConnectionStrings.Redis) ||
  "";
const sqlConn =
  process.env.ConnectionStrings__DefaultConnection ||
  (settings.ConnectionStrings && settings.ConnectionStrings.DefaultConnection) ||
  "";

let redisClient;
let redisReady = false;

async function initRedis() {
  if (!redisConn) return;
  redisClient = createClient({ url: redisConn.startsWith("redis://") ? redisConn : `redis://${redisConn}` });
  redisClient.on("error", () => {
    redisReady = false;
  });
  try {
    await redisClient.connect();
    redisReady = true;
  } catch (e) {
    redisReady = false;
  }
}

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function checkRedis() {
  if (!redisConn) return { configured: false };
  if (!redisClient || !redisClient.isOpen) return { configured: true, ok: false, error: "redis client not connected" };
  try {
    const pong = await redisClient.ping();
    return { configured: true, ok: pong === "PONG" };
  } catch (e) {
    return { configured: true, ok: false, error: e.message };
  }
}

async function checkSql() {
  if (!sqlConn) return { configured: false };
  let pool;
  try {
    pool = await sql.connect(sqlConn);
    await pool.request().query("SELECT 1 AS ok");
    return { configured: true, ok: true };
  } catch (e) {
    return { configured: true, ok: false, error: e.message };
  } finally {
    if (pool) await pool.close();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") {
    return json(res, 200, { ok: true });
  }

  if (req.url === "/deps") {
    const [redis, sqlDb] = await Promise.all([checkRedis(), checkSql()]);
    const ok = (redis.configured ? redis.ok : true) && (sqlDb.configured ? sqlDb.ok : true);
    return json(res, ok ? 200 : 503, {
      ok,
      redis,
      sql: sqlDb,
    });
  }

  return json(res, 200, {
    message: "Hello from Test app",
    config: {
      redisConfigured: !!redisConn,
      sqlConfigured: !!sqlConn,
      redisConnectedOnBoot: redisReady,
    },
    endpoints: ["/healthz", "/deps"],
  });
});

initRedis().finally(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
