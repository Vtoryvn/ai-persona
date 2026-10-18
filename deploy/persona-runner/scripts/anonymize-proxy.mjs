import ProxyChain from "proxy-chain";

const upstream = process.env.BROWSER_PROXY_URL?.trim();
if (!upstream) {
  process.stderr.write("BROWSER_PROXY_URL is empty\n");
  process.exit(1);
}

const localUrl = await ProxyChain.anonymizeProxy(upstream);
process.stdout.write(localUrl);
