import { makeTaskServiceRouter } from "./task-service.js";
import { createSignal } from "../../../lib/mini-signal.js";
import { serveRouter } from "../../../lib/mini-server.js";

const [tasks, setTasks] = createSignal({});
let nextTaskId = 2001;
const generateTaskId = () => `K${nextTaskId++}`;

serveRouter(makeTaskServiceRouter({ tasks, setTasks, generateTaskId }), {
  name: "task",
  defaultPort: 4002,
});
