import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ASSETS = new URL("../.apm/skills/data-protection-guideline/assets/", import.meta.url).pathname;
const sources = JSON.parse(readFileSync(join(ASSETS, "sources.json"), "utf8"));

const PRIMERA_VERSION = {
  rgpd: [5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25, 28, 32, 33, 34, 35],
  lopdgdd: [5, 6, 7, 9, 11, 28, 32, 92],
};
const TITULO = { rgpd: "RGPD", lopdgdd: "LOPDGDD" };

test("sources.json trae los artículos de la primera versión", () => {
  const normas = Object.fromEntries(sources.normas.map((n) => [n.id, n]));
  assert.deepEqual(Object.keys(normas).sort(), ["lopdgdd", "rgpd"]);

  let total = 0;
  for (const [id, esperados] of Object.entries(PRIMERA_VERSION)) {
    const norma = normas[id];
    for (const campo of ["fuente", "enlace", "version", "fechaDescarga"]) {
      assert.ok(norma[campo], `${id}: falta ${campo}`);
    }
    assert.equal(norma.distribucion, "empaquetada", `${id}: distribución`);

    const numeros = norma.articulos.map((a) => a.numero).sort((a, b) => a - b);
    assert.deepEqual(numeros, esperados, `${id}: artículos`);

    for (const { numero, fichero } of norma.articulos) {
      assert.equal(fichero, `${id}/articulo-${numero}.md`, `${id} ${numero}: nombre del fichero`);
      const ruta = join(ASSETS, fichero);
      assert.ok(existsSync(ruta), `${fichero}: no existe`);
      const texto = readFileSync(ruta, "utf8");
      assert.match(texto, new RegExp(`^# ${TITULO[id]} · Artículo ${numero}\\. `), `${fichero}: título`);
      total += 1;
    }
  }
  assert.equal(total, 30);
});

const CHECKLIST = readFileSync(join(ASSETS, "checklist.md"), "utf8");
const CAMPOS_ITEM = ["Cuándo aplica", "Quien construye", "Quien comprueba", "Artículos"];
// Cabecera de cada norma (RF-04): campos en orden y aviso.
const CABECERA = {
  rgpd: {
    campos: ["Fuente", "Enlace", "Versión", "Fecha de descarga", "Aviso", "Adaptación"],
    aviso: "Copia informativa, no auténtica: el texto auténtico es el publicado en el Diario Oficial.",
  },
  lopdgdd: {
    campos: ["Fuente de los datos", "Enlace", "Versión", "Última actualización", "Fecha de descarga", "Aviso", "Adaptación"],
    aviso: "Texto consolidado de carácter informativo, no auténtico: el texto auténtico es el publicado en el Boletín Oficial del Estado.",
  },
};
const FUENTE_BOE = "Agencia Estatal Boletín Oficial del Estado";

// Comprueba la cabecera del fichero contra la de su norma. Devuelve los campos como objeto.
function comprobarCabecera(norma, contenido, donde) {
  const cabecera = contenido.split(/\n\n/)[1] ?? "";
  const campos = [...cabecera.matchAll(/^- \*\*([^*]+):\*\* (\S.*)$/gm)].map(([, nombre, valor]) => [nombre, valor]);
  assert.deepEqual(campos.map(([nombre]) => nombre), CABECERA[norma].campos, `${donde}: campos de la cabecera`);
  const valores = Object.fromEntries(campos);
  assert.equal(valores["Aviso"], CABECERA[norma].aviso, `${donde}: aviso`);
  if (norma === "lopdgdd") {
    assert.equal(valores["Fuente de los datos"], FUENTE_BOE, `${donde}: fuente`);
    assert.match(valores["Versión"], /^BOE-A-\d{4}-\d+, vigente desde \d{4}-\d{2}-\d{2}$/, `${donde}: versión`);
    assert.match(valores["Última actualización"], /^\d{4}-\d{2}-\d{2}$/, `${donde}: última actualización`);
    assert.doesNotMatch(contenido, /Diario Oficial/, `${donde}: menciona el Diario Oficial`);
  }
  return valores;
}

function items(texto) {
  return texto
    .split(/^### /m)
    .slice(1)
    .map((bloque) => {
      const id = bloque.match(/^(DP-\d{2}) · /)?.[1];
      const campos = Object.fromEntries(
        [...bloque.matchAll(/^- \*\*([^*]+):\*\* (.+)$/gm)].map(([, nombre, valor]) => [nombre, valor.trim()]),
      );
      return { id, campos };
    });
}

function referencias(linea) {
  return linea.split(",").map((parte) => {
    const m = parte.trim().match(/^(RGPD|LOPDGDD) (\d+)$/);
    assert.ok(m, `referencia mal escrita: «${parte.trim()}»`);
    return { norma: m[1].toLowerCase(), numero: Number(m[2]), texto: parte.trim() };
  });
}

test("el checklist trae versión, fecha, revisión jurídica y los campos de cada ítem", () => {
  assert.match(CHECKLIST, /^Versión: 0\.1\.0 · Fecha: \d{4}-\d{2}-\d{2} · Revisión jurídica: pendiente$/m);
  const lista = items(CHECKLIST);
  assert.ok(lista.length > 0, "el checklist no tiene ítems");
  for (const { id, campos } of lista) {
    assert.ok(id, "un ítem no tiene id DP-NN");
    for (const campo of CAMPOS_ITEM) {
      assert.ok(campos[campo], `${id}: falta ${campo}`);
    }
  }
});

test("cada referencia del checklist tiene fichero, cabecera y entrada en sources.json", () => {
  const enSources = new Set(
    sources.normas.flatMap((n) => n.articulos.map((a) => `${n.id} ${a.numero} ${a.fichero}`)),
  );
  for (const { id, campos } of items(CHECKLIST)) {
    for (const { norma, numero, texto } of referencias(campos["Artículos"])) {
      const fichero = `${norma}/articulo-${numero}.md`;
      const ruta = join(ASSETS, fichero);
      assert.ok(existsSync(ruta), `${id} ${texto}: no existe ${fichero}`);
      comprobarCabecera(norma, readFileSync(ruta, "utf8"), `${id} ${texto}`);
      assert.ok(enSources.has(`${norma} ${numero} ${fichero}`), `${id} ${texto}: no está en sources.json`);
    }
  }
});

// Escenario 12
test("cada fichero de artículo lleva la cabecera de su norma", () => {
  const normas = Object.fromEntries(sources.normas.map((n) => [n.id, n]));
  assert.equal(normas.lopdgdd.fuente, FUENTE_BOE, "sources.json: fuente de la LOPDGDD");
  const porNorma = { rgpd: 0, lopdgdd: 0 };
  for (const [id, norma] of Object.entries(normas)) {
    for (const articulo of norma.articulos) {
      const valores = comprobarCabecera(id, readFileSync(join(ASSETS, articulo.fichero), "utf8"), articulo.fichero);
      if (id === "lopdgdd") {
        assert.match(articulo.fechaActualizacion ?? "", /^\d{4}-\d{2}-\d{2}$/, `${articulo.fichero}: fechaActualizacion en sources.json`);
        assert.equal(valores["Última actualización"], articulo.fechaActualizacion, `${articulo.fichero}: Última actualización y sources.json`);
        assert.equal(valores["Versión"], `${articulo.idNorma}, vigente desde ${articulo.fechaVigencia}`, `${articulo.fichero}: Versión y sources.json`);
      }
      porNorma[id] += 1;
    }
  }
  assert.deepEqual(porNorma, { rgpd: 22, lopdgdd: 8 });
});

test("DP-04 cita RGPD 8, LOPDGDD 7 y LOPDGDD 92", () => {
  const dp04 = items(CHECKLIST).find((i) => i.id === "DP-04");
  assert.ok(dp04, "falta DP-04");
  const citas = referencias(dp04.campos["Artículos"]).map((r) => r.texto);
  for (const esperada of ["RGPD 8", "LOPDGDD 7", "LOPDGDD 92"]) {
    assert.ok(citas.includes(esperada), `DP-04 no cita ${esperada}`);
  }
  assert.match(dp04.campos["Cuándo aplica"], /menores de 14 años/);
});

test("DP-14 levanta hueco solo en perfilado, predicción, monitorización o rankings", () => {
  const dp14 = items(CHECKLIST).find((i) => i.id === "DP-14");
  assert.ok(dp14, "falta DP-14");
  assert.deepEqual(
    referencias(dp14.campos["Artículos"]).map((r) => r.texto),
    ["RGPD 35"],
  );
  const cuando = dp14.campos["Cuándo aplica"];
  for (const supuesto of ["perfilado", "predicción", "monitorización", "rankings visibles de personas", "gran escala", "menores", "combina fuentes"]) {
    assert.ok(cuando.includes(supuesto), `Cuándo aplica no nombra «${supuesto}»`);
  }
  const frases = dp14.campos["Quien construye"].split(/(?<=\.)\s+/);
  const conHueco = frases.filter((f) => /levanta un hueco/.test(f));
  assert.equal(conHueco.length, 1, "Quien construye debe levantar el hueco en una sola frase");
  const hueco = conHueco[0];
  for (const caso of ["perfilado", "predicción", "monitorización", "rankings visibles de personas"]) {
    assert.ok(hueco.includes(caso), `la frase del hueco no nombra «${caso}»`);
  }
  assert.match(hueco, /Estado de la DPIA está vacío/);
  for (const ajeno of ["gran escala", "categorías especiales", "menores", "combina"]) {
    assert.ok(!hueco.includes(ajeno), `la frase del hueco incluye «${ajeno}»`);
  }
  const resto = frases.find((f) => /gran escala/.test(f));
  assert.ok(resto, "Quien construye no trata la gran escala");
  for (const parte of ["categorías especiales", "menores", "combina fuentes", "nota con DP-14 y RGPD 35", "nunca un hueco"]) {
    assert.ok(resto.includes(parte), `la frase de gran escala no dice «${parte}»`);
  }
  assert.match(dp14.campos["Quien construye"], /Si el campo tiene valor, añade una nota/);
});

test("la plantilla de datos personales trae la sección y sus cuatro campos", () => {
  const plantilla = readFileSync(join(ASSETS, "datos-personales.md"), "utf8");
  assert.match(plantilla, /^## Datos personales$/m);
  for (const campo of ["Rol en el tratamiento", "Interesados", "Categorías especiales", "Estado de la DPIA"]) {
    assert.match(plantilla, new RegExp(`^- \\*\\*${campo}:\\*\\*`, "m"), `falta ${campo}`);
  }
});
