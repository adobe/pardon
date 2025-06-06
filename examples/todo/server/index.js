import { makeTodoServiceRouter } from "./todo-service.js";
import { createServer } from "node:http";
import { buffer, text } from "node:stream/consumers";

function createSignal(value) {
  return [
    () => value,
    (setter) => {
      if (typeof setter === "function") {
        value = setter(value);
      } else {
        value = setter;
      }
    },
  ];
}

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

createServer(async (req, res) => {
  const { method, headers } = req;
  const body = await text(req);
  const response = await todoRouter({
    url: req.url,
    method,
    headers: new Headers(headers),
    body,
  });

  if (!response) {
    console.info(`todo: 404: no route for ${req.method} ${req.url}`);
    res.statusCode = 404;
    return res.end("no response");
  }

  console.info(`todo: ${response.status}: ${req.method} ${req.url}`);

  res.statusCode = response.status;
  res.setHeaders(response.headers);
  res.end(response.body ? await buffer(response.body) : undefined);
}).listen(3000);
