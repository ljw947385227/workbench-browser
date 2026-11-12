import { z } from 'zod'
export const BASE = '/enwork/form-assistant'
export const VERSION = '0.7.0'
export const assignmentsSchema = z.array(z.object({ fieldId: z.string().min(1).max(100), value: z.string().max(8000) })).max(100)
export type Assignment = z.infer<typeof assignmentsSchema>[number]
export const descriptorSchema = z.object({
  title: z.string().max(300), page: z.string().max(500),
  fields: z.array(z.object({
    fieldId: z.string().max(100), label: z.string().max(300), type: z.string().max(50),
    required: z.boolean(), value: z.string().max(8000),
    options: z.array(z.object({ value: z.string().max(500), label: z.string().max(500), disabled: z.boolean().optional() })).max(200).optional(),
    disabled: z.boolean().optional(), multiple: z.boolean().optional(), hint: z.string().max(1000).optional(),
    optionsState: z.enum(['ready', 'needs-open']).optional(),
  })).max(100),
})
export type Descriptor = z.infer<typeof descriptorSchema>
export interface FieldResult { fieldId: string; label: string; status: 'filled' | 'unchanged' | 'conflict' | 'failed'; value: string; previous: string; reason?: string }
export interface FillResult { fields: FieldResult[]; missing: string[] }
export const pageCommandSchema = z.object({
  action: z.enum(['snapshot', 'click', 'hover', 'scroll', 'wait', 'navigate', 'form', 'begin', 'finish']),
  nodeRef: z.string().max(100).optional(), url: z.string().max(2000).optional(),
  direction: z.enum(['up', 'down']).optional(),
})
export type PageCommand = z.infer<typeof pageCommandSchema>
export interface BrowserTask { id: string; action: 'inspect' | 'fill' | 'options' | 'page'; assignments: Assignment[]; fieldId?: string; command?: PageCommand; deadline: number }
