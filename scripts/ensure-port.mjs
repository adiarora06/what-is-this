import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

const port = Number(process.argv[2] || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Provide a valid TCP port.");

const server = createServer();
server.unref();
server.once("error", (error) => {
  if (error.code !== "EADDRINUSE") throw error;
  const owner = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  process.stderr.write(`Port ${port} is already in use.\n${owner.stdout || "Close the existing listener or choose another port.\n"}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => server.close());
