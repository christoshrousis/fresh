import { Deferred, deferred, relative } from "./deps.ts";
import { getEtag } from "../build/snapshot_utils.ts";
import { AssetSnapshot, SnapshotFileInfo } from "./types.ts";
import { bundleEsbuild, EsbuildOptions } from "../build/esbuild.ts";

interface BuildCache {
  files: Map<string, Uint8Array>;
  dependencies: Map<string, string[]>;
}

export class JitSnapshot implements AssetSnapshot {
  #files = new Map<string, Uint8Array>();
  #dependencies = new Map<string, string[]>();
  #etags = new Map<string, string>();
  #def: Deferred<BuildCache> | null = null;

  constructor(private options: EsbuildOptions) {}

  async #bundle() {
    if (this.#def === null) {
      this.#def = deferred();
      const bundle = await bundleEsbuild(this.options);

      for (const file of bundle.outputFiles!) {
        const path = relative(this.options.absoluteWorkingDir, file.path);
        this.#files.set(path, file.contents);
      }

      this.#files.set(
        "metafile.json",
        new TextEncoder().encode(JSON.stringify(bundle.metafile)),
      );

      const metaOutputs = new Map(Object.entries(bundle.metafile!.outputs));

      for (const [path, entry] of metaOutputs.entries()) {
        const imports = entry.imports
          .filter(({ kind }) => kind === "import-statement")
          .map(({ path }) => path);
        this.#dependencies.set(path, imports);
      }

      this.#def!.resolve();
    }

    await this.#def;
  }

  async read(path: string): Promise<ReadableStream<Uint8Array> | null> {
    await this.#bundle();

    new ReadableStream(new Uint8Array());
    return null;
  }

  getDependencies(path: string): string[] {
    return this.#dependencies.get(path) ?? [];
  }

  async getFileInfo(path: string): Promise<SnapshotFileInfo | null> {
    await this.#bundle();

    let etag = this.#etags.get(path);
    if (!etag) {
      etag = await getEtag(path);
      this.#etags.set(path, etag);
    }

    return null;
  }
}