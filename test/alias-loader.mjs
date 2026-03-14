import path from "node:path";
import {pathToFileURL} from "node:url";
import * as tsNodeEsm from "ts-node/esm";

const projectRoot = process.cwd();

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("@src/")) {
    const relativePath = specifier.slice("@src/".length).replace(/\.js$/, ".ts");
    const resolvedUrl = pathToFileURL(path.join(projectRoot, "src", relativePath)).href;
    return tsNodeEsm.resolve(resolvedUrl, context, defaultResolve);
  }

  return tsNodeEsm.resolve(specifier, context, defaultResolve);
}

export const {load} = tsNodeEsm;
