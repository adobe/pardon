import { makeTodoServiceRouter } from "./todo-service.js";
import { createSignal } from "../../lib/mini-signal.js";
import { createServer } from "node:http";
import { buffer, text } from "node:stream/consumers";
import { parseArgs } from "node:util";

const [todos, setTodos] = createSignal({});
const [users, setUsers] = createSignal({});
let nextTodoId = 1001;
const generateTodoId = () => `T${nextTodoId++}`;

const todoRouter = makeTodoServiceRouter({
  users,
  setUsers,
  todos,
  setTodos,
  generateTodoId,
});

const {
  values: { port },
} = parseArgs({
  options: {
    port: {
      short: "p",
      default: "3000",
      type: "string",
    },
  },
});

createServer(async (req, res) => {
  const { method, headers } = req;
  const body = await text(req);
  const response = await todoRouter({
    url: req.url,
    method,
    headers: new Headers(headers),
    body,
  });

  if (splash({ req, res })) {
    return;
  }

  if (!response) {
    console.info(`todo: 404: no route for ${req.method} ${req.url}`);
    res.statusCode = 404;
    return res.end("no response");
  }

  console.info(`todo: ${response.status}: ${req.method} ${req.url}`);

  res.statusCode = response.status;
  res.setHeaders(response.headers);
  res.end(response.body ? await buffer(response.body) : undefined);
}).listen(Number(port));

console.log(`todo service started: http://localhost:${port}`);

// extra route for browser display

function splash({ req, res }) {
  if (!/^[/]([?].*)?$/.test(req.url)) {
    return false;
  }

  res.setHeader("refresh", "2; url=/");
  res.end(
    `
-- please use pardon to interact with this server --

${Object.entries(todos())
  .map(
    ([user, todos]) =>
      `username=${user}\n${Object.entries(todos)
        .map(
          ([todo, { done, task }]) =>
            ` - todo=${todo} [${done ? `x` : " "}] ${task}\n`,
        )
        .join("")}`,
  )
  .join("\n")}
   `.trim(),
  );

  return true;
}
