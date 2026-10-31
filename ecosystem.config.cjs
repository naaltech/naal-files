module.exports = {
  apps: [
    {
      name: "naal-files",
      script: "main.ts",
      interpreter: "node",
      node_args: "--no-warnings --env-file=.env",
    },
  ],
};
