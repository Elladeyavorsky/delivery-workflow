import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractRgpdArticle,
  rgpdArticleParts,
  htmlToMarkdown,
  findBoeBlock,
  lastBoeVersion,
  renderArticle,
  boeBlockUrl,
  boeIndexUrl,
  cellarUrl,
  run,
  RefreshError,
  AVISO,
} from "../.github/scripts/refresh-legal-sources.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "refresh-legal-sources");
const fixture = (name) => readFileSync(join(fixtures, name), "utf8");
const rgpd = fixture("rgpd.xhtml");
const indice = JSON.parse(fixture("boe-indice.json"));
const NOW = () => new Date("2026-11-19T10:00:00Z");

// fetch falso: responde con los fixtures según la URL y anota cada petición.
function fakeFetch({ override = {} } = {}) {
  const calls = [];
  const routes = {
    [cellarUrl("02016R0679-20160504")]: () => fixture("rgpd.xhtml"),
    [boeIndexUrl("BOE-A-2018-16673")]: () => fixture("boe-indice.json"),
    [boeBlockUrl("BOE-A-2018-16673", "a7")]: () => fixture("boe-bloque-a7.xml"),
    [boeBlockUrl("BOE-A-2018-16673", "a2-5")]: () => fixture("boe-bloque-a2-5.xml"),
  };
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (override[url]) return override[url]();
    const route = routes[url];
    if (!route) return { status: 404, text: async () => "" };
    return { status: 200, text: async () => route() };
  };
  impl.calls = calls;
  return impl;
}

function outDir() {
  const root = mkdtempSync(join(tmpdir(), "refresh-legal-"));
  return { root, out: join(root, "assets") };
}

// Escenario 6
test("extractRgpdArticle se detiene al cerrar el div", () => {
  const html = extractRgpdArticle(rgpd, 8);
  assert.match(html, /^<div class="eli-subdivision" id="art_8">/);
  assert.match(html, /Último párrafo del artículo 8\.\s*<\/p>\s*<\/div>$/);
  assert.doesNotMatch(html, /CAPÍTULO III/);
  assert.doesNotMatch(html, /art_12/);

  const { titulo, texto } = rgpdArticleParts(html, 8);
  assert.equal(titulo, "Artículo 8. Condiciones aplicables al consentimiento del niño en relación con los servicios de la sociedad de la información");
  assert.ok(texto.trimEnd().endsWith("Último párrafo del artículo 8."), texto);
  assert.match(texto, /▼C1/);
  assert.match(texto, /▼B/);
  assert.doesNotMatch(texto, /CAPÍTULO/);
  assert.doesNotMatch(texto, /^Artículo 8$/m, "el título no se repite en el texto");
});

test("extractRgpdArticle conserva ▼C2 y decodifica entidades en el último artículo", () => {
  const { texto } = rgpdArticleParts(extractRgpdArticle(rgpd, 12), 12);
  assert.match(texto, /▼C2/);
  assert.match(texto, /sin dilación indebida & en el plazo de un mes\./);
});

test("htmlToMarkdown pone la letra de cada apartado en la misma línea que su texto", () => {
  const { texto } = rgpdArticleParts(extractRgpdArticle(rgpd, 8), 8);
  assert.match(texto, /1\. Cuando se aplique el artículo 6/);
  assert.match(texto, /- a\) que el consentimiento fue dado/);
  assert.match(texto, /- b\) teniendo en cuenta la tecnología disponible\./);
});

test("htmlToMarkdown no cambia el texto, solo normaliza los espacios", () => {
  assert.equal(htmlToMarkdown("<p>Uno   dos\n tres</p><p>cuatro</p>"), "Uno dos tres\n\ncuatro");
});

// CB-03
test("extractRgpdArticle falla y nombra el número si no hay art_N", () => {
  assert.throws(() => extractRgpdArticle(rgpd, 99), (e) => e instanceof RefreshError && /art_99/.test(e.message) && /99/.test(e.message));
});

test("extractRgpdArticle no confunde art_1 con art_12", () => {
  assert.throws(() => extractRgpdArticle(rgpd, 1), RefreshError);
});

// Escenario 7
test("findBoeBlock usa el título y no el id", () => {
  assert.equal(findBoeBlock(indice, 23).id, "a2-5");
  assert.equal(findBoeBlock(indice, 7).id, "a7");
});

test("findBoeBlock no confunde el 23 con el 230 ni el 53 con el 53 bis", () => {
  assert.equal(findBoeBlock(indice, 230).id, "a2-3");
  assert.throws(() => findBoeBlock(indice, 53), RefreshError);
});

// CB-02
test("findBoeBlock falla y nombra el número si no hay bloque «Artículo N»", () => {
  assert.throws(() => findBoeBlock(indice, 92), (e) => e instanceof RefreshError && /Artículo 92/.test(e.message));
});

// Escenario 8
test("lastBoeVersion devuelve la última versión", () => {
  const v = lastBoeVersion(fixture("boe-bloque-a2-5.xml"));
  assert.equal(v.idNorma, "BOE-A-2025-26698");
  assert.equal(v.fechaVigencia, "2025-12-28");
  assert.equal(v.fechaPublicacion, "2025-12-27");
  assert.equal(v.titulo, "Artículo 23. Sistemas de exclusión publicitaria");
  assert.match(v.texto, /1\. Texto de la última versión\./);
  assert.match(v.texto, /a\) Primera letra\./);
  assert.match(v.texto, /^> Se modifica por la disposición final de fixture\./m);
  assert.doesNotMatch(v.texto, /versión original/);
  assert.doesNotMatch(v.texto, /^Artículo 23/m, "el título no se repite en el texto");
});

// CB-04
test("lastBoeVersion guarda igual un bloque con una sola versión", () => {
  const v = lastBoeVersion(fixture("boe-bloque-a7.xml"));
  assert.equal(v.idNorma, "BOE-A-2018-16673");
  assert.equal(v.fechaVigencia, "2018-12-07");
  assert.equal(v.titulo, "Artículo 7. Consentimiento de los menores de edad");
  assert.match(v.texto, /mayor de catorce años\./);
});

test("lastBoeVersion falla si el bloque no tiene versiones", () => {
  assert.throws(() => lastBoeVersion("<bloque></bloque>"), RefreshError);
});

const AVISO_RGPD = "Copia informativa, no auténtica: el texto auténtico es el publicado en el Diario Oficial.";
const AVISO_LOPDGDD = "Texto consolidado de carácter informativo, no auténtico: el texto auténtico es el publicado en el Boletín Oficial del Estado.";
const FUENTE_LOPDGDD = "Agencia Estatal Boletín Oficial del Estado";

// Campos de la cabecera, en orden, tal como aparecen en el fichero.
function camposCabecera(md) {
  return [...md.matchAll(/^- \*\*([^*]+):\*\* (.+)$/gm)].map(([, nombre, valor]) => [nombre, valor]);
}

// Escenario 11
test("renderArticle escribe la cabecera de cada norma", () => {
  assert.deepEqual(AVISO, { rgpd: AVISO_RGPD, lopdgdd: AVISO_LOPDGDD });

  const rgpdMd = renderArticle({
    norma: "RGPD", titulo: "Artículo 5. Principios", fuente: "F", enlace: "E", version: "V", fechaDescarga: "2026-11-19", adaptacion: "A", texto: "Texto.",
  });
  assert.equal(rgpdMd.split("\n")[0], "# RGPD · Artículo 5. Principios");
  assert.deepEqual(camposCabecera(rgpdMd), [
    ["Fuente", "F"], ["Enlace", "E"], ["Versión", "V"], ["Fecha de descarga", "2026-11-19"], ["Aviso", AVISO_RGPD], ["Adaptación", "A"],
  ]);
  assert.ok(rgpdMd.endsWith("Texto.\n"));

  const lopdgddMd = renderArticle({
    norma: "LOPDGDD", titulo: "Artículo 23. Sistemas", fuente: "ignorada", enlace: "E", version: "BOE-A-2025-26698, vigente desde 2025-12-28",
    ultimaActualizacion: "2025-12-27", fechaDescarga: "2026-11-19", adaptacion: "A", texto: "Texto.",
  });
  assert.equal(lopdgddMd.split("\n")[0], "# LOPDGDD · Artículo 23. Sistemas");
  assert.deepEqual(camposCabecera(lopdgddMd), [
    ["Fuente de los datos", FUENTE_LOPDGDD],
    ["Enlace", "E"],
    ["Versión", "BOE-A-2025-26698, vigente desde 2025-12-28"],
    ["Última actualización", "2025-12-27"],
    ["Fecha de descarga", "2026-11-19"],
    ["Aviso", AVISO_LOPDGDD],
    ["Adaptación", "A"],
  ]);
  assert.doesNotMatch(lopdgddMd, /Diario Oficial/);
  assert.ok(lopdgddMd.endsWith("Texto.\n"));
});

// run de punta a punta contra fixtures
test("run escribe los artículos y sources.json con fetch inyectado y sin red", async () => {
  const { root, out } = outDir();
  try {
    const fetch = fakeFetch();
    const msg = await run(["--sources", join(fixtures, "sources.json"), "--out", out], { fetch, now: NOW });
    assert.match(msg, /4 artículos/);
    assert.deepEqual(readdirSync(out).sort(), ["lopdgdd", "rgpd", "sources.json"]);
    assert.deepEqual(readdirSync(join(out, "rgpd")).sort(), ["articulo-12.md", "articulo-8.md"]);
    assert.deepEqual(readdirSync(join(out, "lopdgdd")).sort(), ["articulo-23.md", "articulo-7.md"]);

    const cellarCall = fetch.calls.find((c) => c.url === cellarUrl("02016R0679-20160504"));
    assert.equal(cellarCall.init.headers.Accept, "application/xhtml+xml");
    assert.equal(cellarCall.init.headers["Accept-Language"], "spa");

    const a8 = readFileSync(join(out, "rgpd", "articulo-8.md"), "utf8");
    assert.match(a8, /^# RGPD · Artículo 8\. Condiciones/);
    assert.match(a8, /- \*\*Versión:\*\* 02016R0679-20160504/);
    assert.match(a8, /- \*\*Fecha de descarga:\*\* 2026-11-19/);
    assert.match(a8, /▼C1/);

    const a23 = readFileSync(join(out, "lopdgdd", "articulo-23.md"), "utf8");
    assert.match(a23, /^# LOPDGDD · Artículo 23\. Sistemas de exclusión publicitaria/);
    assert.match(a23, /- \*\*Enlace:\*\* https:\/\/www\.boe\.es\/.*\/texto\/bloque\/a2-5/);
    assert.match(a23, /- \*\*Versión:\*\* BOE-A-2025-26698.*2025-12-28/);
    assert.deepEqual(camposCabecera(a23).map(([nombre]) => nombre), [
      "Fuente de los datos", "Enlace", "Versión", "Última actualización", "Fecha de descarga", "Aviso", "Adaptación",
    ]);
    assert.match(a23, /^- \*\*Fuente de los datos:\*\* Agencia Estatal Boletín Oficial del Estado$/m);
    assert.match(a23, /^- \*\*Versión:\*\* BOE-A-2025-26698, vigente desde 2025-12-28$/m);
    assert.match(a23, /^- \*\*Última actualización:\*\* 2025-12-27$/m);
    assert.ok(a23.includes(`- **Aviso:** ${AVISO_LOPDGDD}\n`), "aviso de la LOPDGDD");
    assert.doesNotMatch(a23, /Diario Oficial/);
    assert.match(a8, new RegExp(`^- \\*\\*Fuente:\\*\\* `, "m"));
    assert.ok(a8.includes(`- **Aviso:** ${AVISO_RGPD}\n`), "aviso del RGPD");

    const sources = JSON.parse(readFileSync(join(out, "sources.json"), "utf8"));
    const [r, l] = sources.normas;
    assert.equal(r.fechaDescarga, "2026-11-19");
    assert.equal(r.distribucion, "empaquetada");
    assert.equal(l.distribucion, "empaquetada");
    const l23 = l.articulos.find((a) => a.numero === 23);
    assert.deepEqual(l23, {
      numero: 23, fichero: "lopdgdd/articulo-23.md", bloque: "a2-5", idNorma: "BOE-A-2025-26698", fechaVigencia: "2025-12-28", fechaActualizacion: "2025-12-27",
    });
    const l7 = l.articulos.find((a) => a.numero === 7);
    assert.equal(l7.bloque, "a7");
    assert.equal(l7.idNorma, "BOE-A-2018-16673");
    assert.equal(l7.fechaActualizacion, "2018-12-06");
    assert.equal(l.fuente, FUENTE_LOPDGDD);

    // No quedan carpetas temporales junto a la salida.
    assert.deepEqual(readdirSync(root), ["assets"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// CB-05 y RNF-04
test("run sale con error con la URL y el código si una respuesta no es 200, y no escribe nada", async () => {
  const { root, out } = outDir();
  try {
    const url = boeBlockUrl("BOE-A-2018-16673", "a2-5");
    const fetch = fakeFetch({ override: { [url]: () => ({ status: 503, text: async () => "" }) } });
    await assert.rejects(
      run(["--sources", join(fixtures, "sources.json"), "--out", out], { fetch, now: NOW }),
      (e) => e instanceof RefreshError && e.message.includes(url) && e.message.includes("503"),
    );
    assert.equal(existsSync(out), false);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run sale con error con la URL si falla la red, y no escribe nada", async () => {
  const { root, out } = outDir();
  try {
    const url = cellarUrl("02016R0679-20160504");
    const fetch = fakeFetch({ override: { [url]: () => { throw new Error("ECONNRESET"); } } });
    await assert.rejects(
      run(["--sources", join(fixtures, "sources.json"), "--out", out], { fetch, now: NOW }),
      (e) => e instanceof RefreshError && e.message.includes(url) && /ECONNRESET/.test(e.message),
    );
    assert.equal(existsSync(out), false);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run no toca una salida previa si un artículo no está en el índice", async () => {
  const { root, out } = outDir();
  try {
    await run(["--sources", join(fixtures, "sources.json"), "--out", out], { fetch: fakeFetch(), now: NOW });
    const before = readFileSync(join(out, "sources.json"), "utf8");
    const indiceSin23 = JSON.parse(fixture("boe-indice.json"));
    indiceSin23.data[0].bloque = indiceSin23.data[0].bloque.filter((b) => b.id !== "a2-5");
    const fetch = fakeFetch({ override: { [boeIndexUrl("BOE-A-2018-16673")]: () => ({ status: 200, text: async () => JSON.stringify(indiceSin23) }) } });
    await assert.rejects(
      run(["--sources", join(fixtures, "sources.json"), "--out", out], { fetch, now: () => new Date("2027-01-01T00:00:00Z") }),
      (e) => e instanceof RefreshError && /Artículo 23/.test(e.message),
    );
    assert.equal(readFileSync(join(out, "sources.json"), "utf8"), before);
    assert.deepEqual(readdirSync(root), ["assets"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// CB-07
for (const [caso, valor] of [["sin fecha_actualizacion", undefined], ["con fecha_actualizacion mal formada", "2025-12-27"]]) {
  test(`run falla y nombra el número si el índice no trae fecha_actualizacion (${caso})`, async () => {
    const { root, out } = outDir();
    try {
      const indiceMal = JSON.parse(fixture("boe-indice.json"));
      const bloque = indiceMal.data[0].bloque.find((b) => b.id === "a2-5");
      if (valor === undefined) delete bloque.fecha_actualizacion;
      else bloque.fecha_actualizacion = valor;
      const fetch = fakeFetch({ override: { [boeIndexUrl("BOE-A-2018-16673")]: () => ({ status: 200, text: async () => JSON.stringify(indiceMal) }) } });
      await assert.rejects(
        run(["--sources", join(fixtures, "sources.json"), "--out", out], { fetch, now: NOW }),
        (e) => e instanceof RefreshError && /\b23\b/.test(e.message) && /fecha_actualizacion/.test(e.message),
      );
      assert.equal(existsSync(out), false);
      assert.deepEqual(readdirSync(root), []);
      assert.ok(!fetch.calls.some((c) => c.url.includes("/texto/bloque/")), "no descarga bloques");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("run rechaza argumentos desconocidos con código 2", async () => {
  await assert.rejects(run(["--nope"], { fetch: fakeFetch(), now: NOW }), (e) => e instanceof RefreshError && e.code === 2);
});
