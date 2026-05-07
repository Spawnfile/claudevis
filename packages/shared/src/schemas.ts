import { z } from 'zod';

const PermissionMode = z.enum(['auto', 'plan', 'autoAccept', 'strict']);

const BaseEvent = z.object({
  id: z.string(),
  ts: z.number(),
  sessionId: z.string(),
  parentEventId: z.string().optional(),
});

export const EventSchema = z.discriminatedUnion('type', [
  BaseEvent.extend({
    type: z.literal('session.started'),
    name: z.string(),
    cwd: z.string(),
    repo: z.string().optional(),
    branch: z.string().optional(),
    model: z.string(),
  }),
  BaseEvent.extend({
    type: z.literal('session.ended'),
    reason: z.enum(['user', 'error', 'complete']),
    exitCode: z.number().optional(),
  }),
  BaseEvent.extend({ type: z.literal('session.idle'), durationMs: z.number() }),
  BaseEvent.extend({ type: z.literal('session.mode.changed'), mode: PermissionMode }),
  BaseEvent.extend({ type: z.literal('user.prompt'), content: z.string() }),
  BaseEvent.extend({
    type: z.literal('agent.thinking'),
    content: z.string(),
    streaming: z.boolean(),
  }),
  BaseEvent.extend({
    type: z.literal('agent.message'),
    content: z.string(),
    streaming: z.boolean(),
  }),
  BaseEvent.extend({
    type: z.literal('tool.started'),
    callId: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  BaseEvent.extend({
    type: z.literal('tool.completed'),
    callId: z.string(),
    output: z.unknown(),
    status: z.enum(['ok', 'error']),
    durationMs: z.number(),
  }),
  BaseEvent.extend({
    type: z.literal('subagent.dispatched'),
    parentCallId: z.string(),
    agentType: z.string(),
    prompt: z.string(),
    childSessionId: z.string(),
  }),
  BaseEvent.extend({
    type: z.literal('subagent.completed'),
    parentCallId: z.string(),
    childSessionId: z.string(),
    result: z.unknown(),
    status: z.enum(['ok', 'error']),
  }),
  BaseEvent.extend({
    type: z.literal('tokens.updated'),
    input: z.number(),
    output: z.number(),
    cached: z.number(),
    costUsd: z.number(),
    model: z.string(),
  }),
  BaseEvent.extend({
    type: z.literal('file.changed'),
    path: z.string(),
    plus: z.number(),
    minus: z.number(),
    preview: z.string().optional(),
  }),
  BaseEvent.extend({
    type: z.literal('permission.requested'),
    requestId: z.string(),
    toolName: z.string(),
    toolInput: z.unknown(),
    preview: z.string().optional(),
    callId: z.string().optional(),
  }),
  BaseEvent.extend({
    type: z.literal('permission.resolved'),
    requestId: z.string(),
    decision: z.enum(['allow', 'deny', 'always']),
  }),
  BaseEvent.extend({
    type: z.literal('skill.invoked'),
    skillName: z.string(),
    args: z.string().optional(),
  }),
  BaseEvent.extend({ type: z.literal('interrupt.signaled') }),
  BaseEvent.extend({
    type: z.literal('error'),
    message: z.string(),
    recoverable: z.boolean(),
  }),
]);

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.create'),
    cwd: z.string(),
    name: z.string().optional(),
    model: z.string().optional(),
    mode: PermissionMode.optional(),
    resume: z.string().optional(),
  }),
  z.object({ type: z.literal('session.send'), sessionId: z.string(), content: z.string() }),
  z.object({ type: z.literal('session.interrupt'), sessionId: z.string() }),
  z.object({ type: z.literal('session.clear'), sessionId: z.string() }),
  z.object({ type: z.literal('session.kill'), sessionId: z.string() }),
  z.object({ type: z.literal('session.setMode'), sessionId: z.string(), mode: PermissionMode }),
  z.object({
    type: z.literal('permission.respond'),
    requestId: z.string(),
    decision: z.enum(['allow', 'deny', 'always']),
  }),
  z.object({ type: z.literal('skill.list') }),
  z.object({
    type: z.literal('skill.run'),
    sessionId: z.string(),
    skillName: z.string(),
    args: z.string().optional(),
  }),
  z.object({ type: z.literal('skill.install'), source: z.string() }),
  z.object({
    type: z.literal('subscribe'),
    sessionIds: z.union([z.array(z.string()), z.literal('*')]),
    replay: z.boolean(),
  }),
  z.object({ type: z.literal('settings.checkClaude') }),
  z.object({ type: z.literal('settings.runLogin') }),
]);
