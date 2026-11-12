import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { Assistant, ACTIVATE, OPEN } from './Assistant.tsx'
import css from './style.module.css'
import { startAutomatic } from './automatic.ts'

export const inject = ['slots', 'locale', 'commandUi', 'layout', 'sidebarRightTabs', 'sidebarRight', 'uiWorkspace', 'conversation']
const PANEL = 'enwork-workbench-browser' as import('@deepseek-ai/dsh-client-ui-layout/client').MainPanelId
function Icon() { return <span aria-hidden='true'>▤</span> }
function BackgroundAssistant({ ctx }: { ctx: Context }) {
  useEffect(() => startAutomatic(ctx), [ctx])
  return <Assistant ctx={ctx} launcher={false} />
}
function Demo() {
  const [kind, setKind] = useState('报名')
  const [show, setShow] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  return <div className={css.page} ref={root}>
    <h2>工作台浏览器助手 · 实机体验</h2><p>点击「关联示例网页」，在聊天框发送“进入合同登记，填写合同名称园区咨询合同，甲方百诺公司，金额12万元”。Agent 可以先点击菜单，再填写表单。</p>
    <div className={css.tabs}><button type='button' aria-pressed={show && kind === '报名'} onClick={() => { setKind('报名'); setShow(true) }}>项目报名</button><button type='button' aria-pressed={show && kind === '合同'} onClick={() => { setKind('合同'); setShow(true) }}>合同登记</button></div>
    {show && <form key={kind} className={css.form} aria-label={`${kind}示例表单`} onSubmit={event => event.preventDefault()}>
      <label>{kind === '报名' ? '项目名称' : '合同名称'} *<input required name='name' /></label>
      <label>{kind === '报名' ? '报名单位' : '甲方名称'} *<input required name='company' /></label>
      <label>{kind === '报名' ? '报名费（元）' : '合同金额（元）'}<input type='number' min='0' step='0.01' name='amount' /></label>
      <label>类别<select name='category'><option value=''>请选择</option><option value='service'>服务类</option><option value='construction'>工程类</option></select></label>
      <label>联系人 *<input required name='contact' /></label>
      <label>联系电话<input type='tel' name='phone' /></label>
      <label>开始日期<input type='date' name='date' /></label>
    </form>}
    <button type='button' onClick={() => { if (root.current) window.dispatchEvent(new CustomEvent(ACTIVATE, { detail: { root: root.current, title: '工作台浏览器助手 · 导航示例' } })) }}>关联示例网页</button>
    <p><em>建议输入：{kind === '报名' ? '项目名称园区咨询，报名单位百诺公司，报名费两千元' : '合同名称园区咨询合同，甲方百诺公司，合同金额12万元'}，服务类，联系人张三，开始日期2026年12月1日。</em></p><p>示例只更新本页控件，不连接业务系统。</p>
  </div>
}
export function apply(ctx: Context): void {
  const open = () => window.dispatchEvent(new Event(OPEN))
  const demo = () => { const binding = ctx.uiWorkspace.currentSession(); if (binding) { ctx.sidebarRight.openTabIn(binding.sessionId, 'enwork-workbench-browser'); ctx.layout.selectPanel(null) } }
  const Help = () => <div className={css.page}><h2>工作台浏览器助手</h2><p>在当前聊天右侧打开网页工作台，直接发送附件和要求，例如“根据这个文件新增一个招标意向”。Agent 自动发现当前聊天的网页，点击新增并识别填写表单，不必手动关联。</p><p>默认没有常驻助手窗口。多个网页时根据任务选择目标，存在歧义时再询问。跨域或沙箱隔离的网页仍需接入桥。</p><button onClick={open}>打开诊断面板</button><button onClick={demo}>打开手动诊断示例</button><p>附件由 Agent 现有文件能力读取，本插件不上传文件。已有值冲突、缺失资料和未支持控件在聊天中报告。请在原网页核对并完成保存或提交。</p></div>
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: '@enwork/workbench-browser', kind: 'enwork-workbench-browser', title: () => '工作台浏览器助手', guide: [{ id: 'workbench-browser', order: 41, title: () => '工作台浏览器助手', description: () => '导航工作台网页并填写表单' }] }), 'form-assist: tab')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: '@enwork/workbench-browser' }, Demo)), 'form-assist: demo')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 22, label: () => '工作台浏览器助手' }, Icon)), 'form-assist: entry')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Help)), 'form-assist: help')
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'enwork-workbench-browser', inject: () => ({ ctx }) }, BackgroundAssistant)), 'form-assist: background')
  ctx.commandUi.register({ name: 'forms', label: () => '工作台浏览器助手', description: () => '按需打开工作台诊断面板；日常聊天无需关联', available: () => !!ctx.uiWorkspace.currentSession(), ui: { kind: 'action', run: open } })
}
