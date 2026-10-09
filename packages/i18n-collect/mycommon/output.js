const fs = require('fs')
const path = require('path')

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writeOutputs(root, config, dictionary, sourceMap, fsImpl = fs) {
  const targets = [
    { file: path.resolve(root, config.outputPath), content: json(dictionary) },
    { file: path.resolve(root, config.sourceMapFilename), content: json(sourceMap) }
  ]
  const stamp = `${process.pid}-${Date.now()}`
  const temp = targets.map(target => ({ ...target, temp: `${target.file}.tmp-${stamp}` }))
  const backups = targets.map(target => `${target.file}.bak-${stamp}`)
  const existed = targets.map(target => fsImpl.existsSync(target.file))
  try {
    for (const target of temp) {
      fsImpl.mkdirSync(path.dirname(target.file), { recursive: true })
      fsImpl.writeFileSync(target.temp, target.content, 'utf8')
    }
    for (let index = 0; index < targets.length; index++) {
      if (existed[index]) fsImpl.renameSync(targets[index].file, backups[index])
    }
    for (const target of temp) fsImpl.renameSync(target.temp, target.file)
    backups.forEach(file => {
      if (fsImpl.existsSync(file)) fsImpl.unlinkSync(file)
    })
  } catch (error) {
    temp.forEach(target => {
      if (fsImpl.existsSync(target.temp)) fsImpl.unlinkSync(target.temp)
    })
    for (let index = 0; index < targets.length; index++) {
      if (fsImpl.existsSync(backups[index])) {
        if (fsImpl.existsSync(targets[index].file)) fsImpl.unlinkSync(targets[index].file)
        fsImpl.renameSync(backups[index], targets[index].file)
      } else if (!existed[index] && fsImpl.existsSync(targets[index].file)) {
        fsImpl.unlinkSync(targets[index].file)
      }
    }
    throw error
  }
}

module.exports = { writeOutputs }
