const fs = require('fs')
const path = require('path')

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function unchanged(fsImpl, file, content) {
  return fsImpl.existsSync(file) && fsImpl.readFileSync(file, 'utf8') === content
}

function journalName(stamp) {
  return `.commit-${stamp}.json`
}

function isCommitJournal(name) {
  return name.startsWith('.commit-') && name.endsWith('.json')
}

function restoreCommit(entries, journal, fsImpl) {
  let restored = true
  const fail = () => {
    restored = false
  }
  for (const entry of entries) {
    try {
      if (entry.temp && fsImpl.existsSync(entry.temp)) fsImpl.unlinkSync(entry.temp)
    } catch (error) {
      fail()
    }
  }
  for (const entry of entries) {
    try {
      if (entry.backup && fsImpl.existsSync(entry.backup)) {
        if (fsImpl.existsSync(entry.file)) fsImpl.unlinkSync(entry.file)
        fsImpl.renameSync(entry.backup, entry.file)
      } else if (!entry.existed && fsImpl.existsSync(entry.file)) {
        fsImpl.unlinkSync(entry.file)
      }
    } catch (error) {
      fail()
    }
  }
  if (restored && journal && fsImpl.existsSync(journal)) {
    try {
      fsImpl.unlinkSync(journal)
    } catch (error) {
      fail()
    }
  }
  return restored
}

// An incomplete commit leaves a journal. The next commit restores every file in it
// before reading or replacing catalogs, then removes the journal.
function recoverCommits(dir, fsImpl = fs) {
  if (!fsImpl.existsSync(dir)) return
  const names = fsImpl.readdirSync(dir).filter(isCommitJournal).sort()
  for (const name of names) {
    const journal = path.join(dir, name)
    let parsed
    try {
      parsed = JSON.parse(fsImpl.readFileSync(journal, 'utf8'))
    } catch (error) {
      const failure = new Error(`cannot read commit journal ${name}: ${error.message}`)
      failure.kind = 'storage'
      failure.restored = false
      throw failure
    }
    if (!parsed || !Array.isArray(parsed.files)) {
      const failure = new Error(`commit journal ${name} is invalid`)
      failure.kind = 'storage'
      failure.restored = false
      throw failure
    }
    if (!restoreCommit(parsed.files, journal, fsImpl)) {
      const failure = new Error(`cannot restore catalogs from commit journal ${name}`)
      failure.kind = 'storage'
      failure.restored = false
      throw failure
    }
  }
}

// Prepare every file, record the set, then replace it. The journal is removed only
// after every replacement. A failure, or a later run that still finds the journal,
// restores the previous files. Backup cleanup happens after that commit point.
function commitFiles(targets, fsImpl = fs) {
  if (targets.length === 0) return
  const dirs = [...new Set(targets.map(target => path.dirname(target.file)))]
  for (const dir of dirs) recoverCommits(dir, fsImpl)
  const stamp = `${process.pid}-${Date.now()}`
  const entries = targets.map(target => ({
    file: target.file,
    content: target.content,
    temp: `${target.file}.tmp-${stamp}`,
    backup: `${target.file}.bak-${stamp}`,
    existed: fsImpl.existsSync(target.file)
  }))
  const journal = path.join(path.dirname(entries[0].file), journalName(stamp))
  const onExit = () => {
    try {
      if (fsImpl.existsSync(journal)) restoreCommit(entries, journal, fsImpl)
    } catch (error) {
      // The process is already exiting. The journal stays for the next translate.
    }
  }
  process.on('exit', onExit)
  try {
    for (const entry of entries) fsImpl.mkdirSync(path.dirname(entry.file), { recursive: true })
    fsImpl.writeFileSync(journal, json({
      files: entries.map(({ file, temp, backup, existed }) => ({ file, temp, backup, existed }))
    }))
    for (const entry of entries) fsImpl.writeFileSync(entry.temp, entry.content, 'utf8')
    for (const entry of entries) {
      if (entry.existed) fsImpl.renameSync(entry.file, entry.backup)
    }
    for (const entry of entries) fsImpl.renameSync(entry.temp, entry.file)
    fsImpl.unlinkSync(journal)
  } catch (error) {
    if (!restoreCommit(entries, journal, fsImpl)) error.restored = false
    throw error
  } finally {
    process.removeListener('exit', onExit)
  }
  for (const entry of entries) {
    try {
      if (fsImpl.existsSync(entry.backup)) fsImpl.unlinkSync(entry.backup)
    } catch (error) {
      // The replacement is already committed. A leftover backup is not catalog content.
    }
  }
}

// extraFiles: [{ path, content }] with project-relative paths, written in the same transaction.
async function writeOutputs(root, config, dictionary, sourceMap, fsImpl = fs, extraFiles = []) {
  const targets = [
    { file: path.resolve(root, config.outputPath), content: json(dictionary) },
    { file: path.resolve(root, config.sourceMapFilename), content: json(sourceMap) },
    ...extraFiles.map(extra => ({ file: path.resolve(root, extra.path), content: extra.content }))
  ].filter(target => !unchanged(fsImpl, target.file, target.content))
  commitFiles(targets, fsImpl)
}

module.exports = { commitFiles, json, recoverCommits, unchanged, writeOutputs }
