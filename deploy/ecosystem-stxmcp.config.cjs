/** pm2 start deploy/ecosystem-stxmcp.config.cjs */
module.exports = {
  apps: [
    {
      name: "paysats-stxmcp",
      cwd: __dirname + "/..",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: "3500",
        MCP_PRODUCT: "stacks",
      },
    },
  ],
};
