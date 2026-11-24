"use strict";

function readConfig() {
  const raw = process.env.BOUNDARIES_CONFIG;
  if (raw == null || raw === "") {
    throw new Error(
      "Falta la variable de entorno BOUNDARIES_CONFIG (JSON de fronteras del mapa)."
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("BOUNDARIES_CONFIG no es JSON válido.");
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function layerPaths(layers, name) {
  const list = layers && layers[name];
  return Array.isArray(list) ? list.filter((item) => item !== "") : [];
}

function rule(name, from, to) {
  return { name, severity: "error", from, to };
}

const config = readConfig();
const layers = config.layers || {};
const presentation = layerPaths(layers, "presentation");
const application = layerPaths(layers, "application");
const domain = layerPaths(layers, "domain");
const infrastructure = layerPaths(layers, "infrastructure");
const shared = layerPaths(layers, "shared");
const platform = layerPaths(layers, "platform");
const allowed = Array.isArray(config.domainAllowedPackages)
  ? config.domainAllowedPackages.filter(Boolean)
  : [];

const forbidden = [rule("R-GEN-04", {}, { circular: true })];

if (domain.length > 0) {
  const domainToLayers = [
    ...presentation,
    ...application,
    ...infrastructure,
    ...platform,
  ];
  if (domainToLayers.length > 0) {
    forbidden.push(rule("R-DOM-01", { path: domain }, { path: domainToLayers }));
  }
  const npmTo = { dependencyTypes: ["core", "npm"] };
  if (allowed.length > 0) {
    npmTo.pathNot = allowed.map(escapeRegex);
  }
  forbidden.push(rule("R-DOM-01", { path: domain }, npmTo));
}

if (presentation.length > 0 && infrastructure.length > 0) {
  forbidden.push(
    rule("R-PRE-04", { path: presentation }, { path: infrastructure })
  );
}

if (shared.length > 0) {
  const sharedTo = [
    ...presentation,
    ...application,
    ...domain,
    ...infrastructure,
    ...platform,
  ];
  if (sharedTo.length > 0) {
    forbidden.push(rule("R-SHR-01", { path: shared }, { path: sharedTo }));
  }
}

const modules = config.modules || {};
const modulePattern = typeof modules.pattern === "string" ? modules.pattern : "";
const publicApi = typeof modules.publicApi === "string" ? modules.publicApi : "";
if (modulePattern !== "") {
  const pathNot = ["$0"];
  if (publicApi !== "") {
    pathNot.push(publicApi);
  }
  forbidden.push(
    rule(
      "R-EST-02",
      { path: modulePattern },
      { path: modulePattern, pathNot }
    )
  );
}

if (application.length > 0) {
  const appForbidden = [...presentation, ...infrastructure, ...platform];
  if (appForbidden.length > 0) {
    forbidden.push(
      rule("R-FLU-02", { path: application }, { path: appForbidden })
    );
  }
}
if (infrastructure.length > 0 && presentation.length > 0) {
  forbidden.push(
    rule("R-FLU-02", { path: infrastructure }, { path: presentation })
  );
}
if (platform.length > 0) {
  const platformForbidden = [...presentation, ...domain, ...infrastructure];
  if (platformForbidden.length > 0) {
    forbidden.push(
      rule("R-FLU-02", { path: platform }, { path: platformForbidden })
    );
  }
}

module.exports = { forbidden };
