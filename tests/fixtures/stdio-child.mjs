const result = process.env.DIFFAI_RESULT;
if (!result) process.exit(2);
if (process.env.DIFFAI_STDIO_MODE === "valid") {
  process.stderr.write("diagnostic: review server\nURL: http://127.0.0.1:4987\n");
  process.stdout.write(`${result}\r\n`);
} else {
  process.stdout.write(`diagnostic: stdout is not allowed\nhttp://127.0.0.1:4987\n${result}\n`);
}
