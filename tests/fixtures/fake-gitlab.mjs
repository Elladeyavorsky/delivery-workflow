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
const person = (id) => ({ id });
// Un plan con una sola persona asignada se queda con la última que se pide.
// Sin permiso, GitLab ignora la asignación sin dar error.
const assignees = (ids) => (state.ignoreAssignees ? [] : state.singleAssignee ? ids.slice(-1) : ids).map(person);

if (url.pathname === "/api/v4/user") reply(200, state.me);
const users = state.users ?? [];
if (url.pathname === "/api/v4/users") reply(200, users.filter((user) => user.username.toLowerCase() === url.searchParams.get("username").toLowerCase()));

const requests = state.mergeRequests ?? {};
if (url.pathname === "/api/graphql") {
  if (state.noReviewState) reply(200, { errors: [{ message: "Field 'reviewState' doesn't exist" }] });
  if (body.query.startsWith("mutation")) {
    if (state.denyRereview) reply(403, { message: "403 Forbidden" });
    const { iid, userId } = body.variables.input;
    const user = requests[iid].reviewers.find((item) => `gid://gitlab/User/${item.id}` === userId);
    user.state = "UNREVIEWED";
    reply(200, { data: { mergeRequestReviewerRereview: { errors: [] } } });
  }
  if (body.variables.path !== state.project) reply(200, { data: { project: null } });
  const nodes = requests[body.variables.iid].reviewers.map((item) => ({ username: item.username, mergeRequestInteraction: { reviewState: item.state ?? "UNREVIEWED" } }));
  reply(200, { data: { project: { mergeRequest: { reviewers: { nodes } } } } });
}

const own = url.pathname.match(/^\/api\/v4\/projects\/([^/]+)$/);
if (own && decodeURIComponent(own[1]) === state.project) {
  reply(200, { path_with_namespace: state.project, ...(state.forkedFrom ? { forked_from_project: { path_with_namespace: state.forkedFrom } } : {}) });
}

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

const isDraft = (title) => /^\s*(\[draft\]|\(draft\)|draft:)/i.test(title);
const byId = (id) => users.find((user) => user.id === id) ?? { id };
// Un plan con un solo revisor se queda con el primero que se pide.
const reviewers = (item, ids) => (state.singleReviewer ? ids.slice(0, 1) : ids)
  .map((id) => item.reviewers.find((current) => current.id === id) ?? { ...byId(id) });

if (rest === "merge_requests") {
  if (method === "GET") {
    const wanted = (item, name) => !url.searchParams.has(name) || item[name] === url.searchParams.get(name);
    page(Object.values(requests).filter((item) => item.state === url.searchParams.get("state") && wanted(item, "source_branch") && wanted(item, "target_branch")));
  }
  const iid = Object.keys(requests).length + 1;
  const item = {
    iid, state: "opened", title: body.title, description: body.description, draft: isDraft(body.title),
    source_branch: body.source_branch, target_branch: body.target_branch, source_project_id: 1, target_project_id: 1,
    author: state.me, assignees: assignees(body.assignee_ids ?? []), reviewers: [], labels: body.labels ? body.labels.split(",") : [],
    web_url: `https://gitlab.com/${state.project}/-/merge_requests/${iid}`,
  };
  state.mergeRequests = { ...requests, [iid]: item };
  reply(201, item);
}

const mr = rest.match(/^merge_requests\/(\d+)(?:\/(discussions|approvals))?$/);
if (mr) {
  const item = requests[mr[1]];
  if (!item) reply(404, { message: "404 Not found" });
  if (mr[2] === "discussions") page(item.discussions ?? []);
  if (mr[2] === "approvals") {
    reply(200, { approved_by: (item.approvedBy ?? []).map((user) => ({ user: { username: user } })), ...(item.approvalsLeft === undefined ? {} : { approvals_left: item.approvalsLeft }) });
  }
  if (method === "PUT") {
    if (state.denyEdit) forbidden();
    if (body.title !== undefined) Object.assign(item, { title: body.title, draft: isDraft(body.title) });
    if (body.description !== undefined) item.description = body.description;
    if (body.assignee_ids) item.assignees = assignees(body.assignee_ids);
    // Sin permiso para administrarlo, GitLab ignora los revisores sin dar error.
    if (body.reviewer_ids && !state.ignoreReviewers) item.reviewers = reviewers(item, body.reviewer_ids);
  }
  reply(200, item);
}

if (rest === "members/all") {
  if (state.etag && args.includes(`If-None-Match: ${state.etag}`)) reply(304);
  const list = users.filter((user) => state.members[user.id] !== undefined).map((user) => ({ ...user, access_level: state.members[user.id], email: "no@guardar.example" }));
  const size = state.pageSize ?? 100;
  const current = Number(url.searchParams.get("page") ?? 1);
  reply(200, list.slice((current - 1) * size, current * size), { "x-next-page": current * size < list.length ? current + 1 : "", ...(state.etag ? { etag: state.etag } : {}) });
}

const members = rest.match(/^members\/all\/(\d+)$/);
if (members) {
  const level = state.members[members[1]];
  if (level === undefined) reply(404, { message: "404 Not found" });
  reply(200, { id: Number(members[1]), access_level: level });
}


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
    // Sin permiso, GitLab puede ignorar el cambio de estado sin dar error.
    if (body.state_event && !state.ignoreState) issue.state = body.state_event === "close" ? "closed" : "opened";
    if (body.assignee_ids) issue.assignees = assignees(body.assignee_ids);
  }
  reply(200, issue);
}
if (method === "GET" && found[2]) reply(200, issue.notes.find((item) => item.id === Number(found[2])));
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
