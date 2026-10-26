
const next = require("next");
const http = require("http");

const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      handle(req, res);
    });

    const port = Number(process.env.PORT || 3000);

    server.listen(port, "0.0.0.0", () => {
      console.log(`Customer Portal running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Customer Portal startup failed:", error);
    process.exit(1);
  });
