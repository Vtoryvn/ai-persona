import ProxyChain from "proxy-chain";

const upstream = process.env.BROWSER_PROXY_URL?.trim();
if (!upstream) {
  process.stderr.write("BROWSER_PROXY_URL is empty\n");
  process.exit(1);
}

const localUrl = await ProxyChain.anonymizeProxy(upstream);
process.stdout.write(`${localUrl}\n`);

// Keep the local forwarder alive for Chrome; start.sh runs this in the background.
const keepAlive = setInterval(() => {}, 86_400_000);
function shutdown() {
  clearInterval(keepAlive);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
