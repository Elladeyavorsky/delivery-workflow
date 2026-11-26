// Un curl falso que hace de GitLab. Se pone en el PATH con el nombre curl.
// El estado del proyecto vive en el JSON de FAKE_GITLAB y cada llamada queda anotada en él.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const store = process.env.FAKE_GITLAB;
const state = JSON.parse(readFileSync(store, "utf8"));
const url = new URL(option("--url"));
const method = option("--request");
const data = option("--data-binary");
const body = data ? JSON.parse(readFileSync(data.slice(1), "utf8")) : undefined;
const token = readFileSync(0, "utf8").match(/PRIVATE-TOKEN: ([^"]+)"/)?.[1];

state.calls.push({ method, path: `${url.pathname}${url.search}`, args, body });

function reply(status, payload, headers = {}) {
  writeFileSync(store, JSON.stringify(state));
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  writeFileSync(option("--dump-header"), [`HTTP/2 ${status}`, ...lines, "", ""].join("\r\n"));
  writeFileSync(option("--output"), payload === undefined ? "" : JSON.stringify(payload));
  process.stdout.write(String(status));
  process.exit(0);
}

// Reparte la lista en páginas pequeñas para obligar a leerlas todas.
function page(list) {
  const size = state.pageSize ?? 100;
  const current = Number(url.searchParams.get("page") ?? 1);
  reply(200, list.slice((current - 1) * size, current * size), { "x-next-page": current * size < list.length ? current + 1 : "" });
}

if (token !== state.token) reply(401, { message: "401 Unauthorized" });
if (url.pathname === "/api/v4/user") reply(200, state.me);

const route = url.pathname.match(/^\/api\/v4\/projects\/([^/]+)\/(.*)$/);
if (!route || decodeURIComponent(route[1]) !== state.project) reply(404, { message: "404 Project Not Found" });
const rest = route[2];
const forbidden = () => reply(403, state.noScope ? { error: "insufficient_scope" } : { message: "403 Forbidden" });
if (state.noScope && method !== "GET") forbidden();

if (rest === "labels") {
  if (method === "GET") page(state.labels.filter((label) => label.name.toLowerCase().includes((url.searchParams.get("search") ?? "").toLowerCase())));
  if (state.denyLabel) forbidden();
  state.labels.push(body);
  reply(201, body);
}

const members = rest.match(/^members\/all\/(\d+)$/);
if (members) {
  const level = state.members[members[1]];
  if (level === undefined) reply(404, { message: "404 Not found" });
  reply(200, { id: Number(members[1]), access_level: level });
}

const person = (id) => ({ id });
// Un plan con una sola persona asignada se queda con la última que se pide.
const assignees = (ids) => (state.singleAssignee ? ids.slice(-1) : ids).map(person);

if (rest === "issues" && method === "POST") {
  const iid = Object.keys(state.issues).length + 1;
  const issue = {
    iid, state: "opened", title: body.title, description: body.description, author: person(state.me.id),
    labels: body.labels ? body.labels.split(",") : [], assignees: assignees(body.assignee_ids ?? []),
    web_url: `https://gitlab.com/${state.project}/-/issues/${iid}`, notes: [],
  };
  state.issues[iid] = issue;
  reply(201, issue);
}

const found = rest.match(/^issues\/(\d+)(?:\/notes(?:\/(\d+))?)?$/);
const issue = found && state.issues[found[1]];
if (!issue) reply(404, { message: "404 Not found" });
if (method !== "GET" && state.denyEdit) forbidden();

if (!rest.includes("/notes")) {
  if (method === "PUT") {
    if (body.description !== undefined) issue.description = body.description;
    if (body.state_event) issue.state = body.state_event === "close" ? "closed" : "opened";
    if (body.assignee_ids) issue.assignees = assignees(body.assignee_ids);
  }
  reply(200, issue);
}
if (method === "GET") {
  // Sin sort=asc, GitLab devuelve primero lo más nuevo.
  page(url.searchParams.get("sort") === "asc" ? issue.notes : [...issue.notes].reverse());
}
if (method === "POST") {
  const note = { id: issue.notes.length + 1, body: body.body, system: false };
  issue.notes.push(note);
  reply(201, note);
}
const note = issue.notes.find((item) => item.id === Number(found[2]));
note.body = body.body;
reply(200, note);
