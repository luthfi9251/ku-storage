export type PickedFile = { file: File; relPath: string }

function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntry[] = []
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(out)
        else {
          out.push(...batch)
          next()
        }
      }, reject)
    next()
  })
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function walk(entry: FileSystemEntry, base: string, out: PickedFile[]): Promise<void> {
  const rel = base ? `${base}/${entry.name}` : entry.name
  if (entry.isFile) {
    out.push({ file: await entryFile(entry as FileSystemFileEntry), relPath: rel })
  } else if (entry.isDirectory) {
    const children = await readAll((entry as FileSystemDirectoryEntry).createReader())
    for (const c of children) await walk(c, rel, out)
  }
}

/**
 * Collects dropped files and folders. Folder structure is preserved in relPath
 * ("folder/sub/file.txt"). Entries must be grabbed synchronously inside the drop
 * handler, which this does before awaiting anything.
 */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const entries: FileSystemEntry[] = []
  const loose: File[] = []
  const items = Array.from(dt.items ?? [])
  if (items.length > 0) {
    for (const it of items) {
      if (it.kind !== 'file') continue
      const e = typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null
      if (e) entries.push(e)
      else {
        const f = it.getAsFile()
        if (f) loose.push(f)
      }
    }
  } else {
    loose.push(...Array.from(dt.files))
  }
  const out: PickedFile[] = loose.map((f) => ({ file: f, relPath: f.name }))
  for (const e of entries) await walk(e, '', out)
  return out
}

/** Files from an <input type=file> (with or without webkitdirectory). */
export function filesFromInput(list: FileList | null): PickedFile[] {
  return Array.from(list ?? []).map((f) => ({ file: f, relPath: f.webkitRelativePath || f.name }))
}
