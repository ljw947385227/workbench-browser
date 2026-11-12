import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { root } from './toolchain.mjs'
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
for (const name of ['lib/index.js', 'lib/client.js']) if (!existsSync(join(root, name))) throw new Error('Run npm run build before packing')
if (!readFileSync(join(root, 'lib/client.js'), 'utf8').includes(`id: "${manifest.name}"`)) throw new Error('Client module identity does not match package')
const out = join(root, 'dist'); mkdirSync(out, { recursive: true })
const cli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const [packed] = JSON.parse(execFileSync(process.execPath, [cli, 'pack', '--ignore-scripts', '--pack-destination', out, '--json'], { cwd: root, encoding: 'utf8' }))
writeFileSync(join(out, 'index.json'), JSON.stringify({ name: manifest.name, version: manifest.version, tarball: packed.filename, integrity: packed.integrity, shasum: packed.shasum }, null, 2) + '\n')
writeFileSync(join(out, 'INSTALL.md'), `# 工作台浏览器助手 ${manifest.version}\n\n在 EnWork 的“插件 → 安装第三方插件”中输入以下绝对路径，安装并启用。先卸载旧包 @enwork/form-assistant（以及旧版 @enwork/workbench-browser，如有），再安装新包；请勿同时启用两者，按提示刷新或重启。\n\n${join(out, packed.filename)}\n\n在当前聊天右侧打开投标等网页工作台，直接发送附件和要求，例如“根据这个文件新增一个招标意向，填好后让我核对”。不需要点击助手、手动关联或发送网页引用；默认没有常驻浮窗。Agent 自动发现右侧网页、点击新增并填写表单。\n\n多个网页时按任务选择目标，存在歧义时再询问。只自动关联当前聊天右侧的可读同源 iframe；其他聊天、主栏、跨域和未挂载页面不在自动范围内。独立浏览器继续使用已安装的 wqty123/dsh-browser。附件由 Agent 现有文件能力读取，本插件不上传文件；保存与提交由你完成。\n`)
console.log(join(out, packed.filename))
