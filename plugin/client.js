// dsh-expert-council — Web Client half.
//
// Loaded by the Harness module loader exactly as declared in package.json
// (`dsh.client` + `exports["./client"]`). No build step, no JSX, no bare
// imports: only `require('react')` (served by the host module table).
//
// Registers:
//   * keyed slot `tool.call.toolview` for consult_expert / consult_council /
//     followup_expert / verify_consultation
//   * list slot `settings.section` with the `expert-council` page
//
// All card data comes from the tool result `block.meta` (the host
// `presentationMeta()` value), so replaying an old session renders the same
// cards with no extra state and no extra requests.
window.__ModuleLoader__.load({
  id: 'dsh-expert-council',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useMemo = React.useMemo
    const useRef = React.useRef

    // ------------------------------------------------------------------
    // Localization
    //
    // Every user-visible string lives in MESSAGES_EN / MESSAGES_ZH below and
    // is rendered through `t(key, params)`. The host locale service is taken
    // *optionally* (`ctx.get('locale')`) so a host without it still activates
    // this plugin: `t()` then falls back to the built-in English dictionary
    // and never leaks a bare key.
    //
    // Keys are `domain.semantic` (card.status, settings.saveKey, ...). Error
    // categories keep the uppercase enum name on purpose: the key mirrors the
    // host `ErrorCategory` value one-to-one.
    // ------------------------------------------------------------------

    const NAMESPACE = 'dsh-expert-council'

    const MESSAGES_EN = {
      'common.unknown': 'unknown',
      'common.unknownId': 'unknown id',
      'common.unknownProtocol': 'unknown protocol',
      'common.none': 'none',
      'common.yes': 'yes',
      'common.no': 'no',
      'common.empty': '(empty)',
      'common.emptyResult': '(empty result)',
      'common.noAnswerInline': '(no answer text)',
      'common.unnamed': 'unnamed',
      'common.noModel': 'no model',
      'common.copy': 'Copy',
      'common.copied': 'Copied',
      'common.copyToClipboard': 'Copy to clipboard',
      'common.copyJson': 'Copy JSON',
      'common.show': 'Show',
      'common.hide': 'Hide',
      'common.details': 'Details',

      'unit.milliseconds': '{value} ms',
      'unit.seconds': '{value} s',
      'unit.bytes': '{value} B',
      'unit.kilobytes': '{value} KB',
      'unit.megabytes': '{value} MB',
      'unit.chars': '{value} chars',

      'protocol.anthropicMessages': 'Anthropic Messages',
      'protocol.openaiChatCompletions': 'OpenAI Chat Completions',

      'usage.unknown': 'usage unknown',
      'usage.input': 'in {value}',
      'usage.output': 'out {value}',
      'usage.total': 'total {value}',
      'usage.cache': 'cache {value}',
      'usage.reasoning': 'reasoning {value}',

      'tool.consultExpert': 'Expert Consultation',
      'tool.consultCouncil': 'Expert Council',
      'tool.followupExpert': 'Expert Follow-up',
      'tool.verifyConsultation': 'Consultation Verification',

      'card.titleSlot': '{title} · {slot}',
      'card.titleSlotName': '{title} · {slot} {name}',
      'card.councilTitle': '{title} · {slots}',
      'card.pendingPreparing': 'Preparing consultation…',
      'card.pendingConsulting': 'Consulting external expert models…',
      'card.pendingWithSummary': '{label} — {summary}',
      'card.pendingNote': 'This call has not returned a result yet.',
      'card.copyAnswer': 'Copy answer',
      'card.copyReport': 'Copy report',
      'card.inspect': 'Inspect',
      'card.summaryTitle': 'Summary',
      'card.consultationId': 'Consultation id',
      'card.status': 'Status',
      'card.mode': 'Mode',
      'card.reason': 'Reason',
      'card.requestedOutput': 'Requested output',
      'card.duration': 'Duration',
      'card.requestedSlot': 'Requested slot',
      'card.autoRouted': 'Auto routed',
      'card.routingPolicy': 'Routing policy',
      'card.finishReason': 'Finish reason',
      'card.attempts': 'Attempts',
      'card.requestId': 'Request id',
      'card.questionTitle': 'Question',
      'card.copyQuestion': 'Copy question',
      'card.context': 'Context',
      'card.evidence': 'Evidence',
      'card.questionHash': 'Question hash',
      'card.fullAnswer': 'Full answer',
      'card.noAnswerSlot': 'No answer text was recorded for this slot.',
      'card.requestSystem': 'System',
      'card.requestUser': 'User',
      'card.requestHash': 'Request hash',
      'card.sentBytes': 'Sent bytes',
      'card.requestTitle': 'Redacted request actually sent',
      'card.copyRequest': 'Copy request',
      'card.originalBytes': 'Original bytes',
      'card.rulesApplied': 'Rules applied',
      'card.redactions': 'Redactions',
      'card.externalBytes': 'External bytes',
      'card.truncated': 'Truncated',
      'card.appliedRules': 'Applied rules',
      'card.redactionTitle': 'Redaction',
      'card.configRevision': 'Config revision',
      'card.diagnosticsTitle': 'Diagnostics',
      'card.diagnosticsNotes': 'Host notes (verbatim)',
      'card.rawJsonTitle': 'Raw metadata (JSON)',
      'card.toolCallFailed': 'Tool call failed',
      'card.toolCallFailedDetail': 'The host reported this consultation as an error.',
      'card.errorHttpStatus': 'HTTP status',
      'card.errorProviderCode': 'Provider code',
      'card.errorRetryable': 'Retryable',
      'card.returnedCount': '{success}/{requested} returned',
      'card.councilSubLine': '{returned} · {duration} · cost {cost}',
      'card.copyComparison': 'Copy 3-way comparison',
      'card.questionSnapshotTitle': 'Question (shared snapshot)',
      'card.synthesisTitle': 'Council Synthesis',
      'card.synthesisSubtitle': 'mechanical aggregation · not a semantic verdict',
      'card.synthesisNote':
        'Mechanical lexical overlap only — it does not mean factual agreement. The main agent must verify independently.',
      'card.overlapTitle': 'Overlap tokens (lexical)',
      'card.overlapEmpty': 'No shared tokens were found across slots.',
      'card.uniqueBySlotTitle': 'Unique by slot',
      'card.uniqueEmpty': 'No per-slot unique items were recorded.',
      'card.answerLengthsTitle': 'Answer lengths',
      'card.noSynthesis': 'No synthesis metadata was recorded for this council run.',
      'card.noModelConfigured': 'no model configured',
      'card.noAnswerRecorded': 'No answer text was recorded.',
      'card.collapse': 'Collapse',
      'card.expandAnswer': 'Expand answer',
      'card.noStructuredMeta': 'no structured metadata',
      'card.fallbackNote':
        'Structured metadata is unavailable for this call, so only the raw tool result text is shown.',
      'card.copyResultText': 'Copy result text',
      'card.recordedVerdictTitle': 'Recorded verdict',
      'card.copyNotes': 'Copy notes',
      'card.verdict': 'Verdict',
      'card.recordedAt': 'Recorded at',
      'card.noVerdictDetails': 'This verification recorded no verdict details.',
      'card.decisionFallback': 'DECISION',

      'report.singleHeader': 'Expert Consultation — {id}',
      'report.statusLine': 'Status: {status} · duration: {duration}',
      'report.slotLine': 'Slot: {slot} {name} · {model} · {status} · {duration}',
      'report.protocolLine': 'Protocol: {protocol} · host: {host}',
      'report.answerHeading': '--- Answer ---',
      'report.councilHeader': 'Expert Council — {id}',
      'report.councilStatusLine': 'Status: {status} · {returned} · duration {duration}',
      'report.totalCost': 'Total cost: {cost}',
      'report.questionHeading': '--- Question (shared snapshot) ---',
      'report.slotHeading': '--- {slot} · {name} · {model} · {status} · {duration} ---',
      'report.errorLine': '[error] {category}: {message}',
      'report.synthesisHeading': '--- Mechanical synthesis (lexical only, not factual agreement) ---',
      'report.noSynthesis': '(no synthesis metadata)',
      'report.note': 'Note: {note}',
      'report.overlap': 'Overlap: {value}',
      'report.uniqueBySlot': 'Unique by slot: {value}',
      'report.answerLengths': 'Answer lengths: {value}',
      'report.answerLength': '{slot} {chars} chars',
      'report.decision': 'Decision: {verdict} — {notes}',

      'settings.navLabel': 'Expert Council',
      'settings.title': 'Expert Council',
      'settings.description':
        'Configure up to three external expert model slots. L1 is the frontier reasoning tier, L2 the advanced tier and L3 the core tier. Credentials are stored by the host and are never rendered here.',
      'settings.refresh': 'Refresh',
      'settings.refreshing': 'Refreshing…',
      'settings.defaultsLine': 'Defaults: single slot {slot} · council {council}',
      'settings.allowed': 'allowed',
      'settings.disabled': 'disabled',
      'settings.stateVersion': 'state version {version}',
      'settings.loadFailed': 'Could not load the Expert Council state: {message}',
      'settings.loadFailedHint':
        'The settings routes answer only on the loopback interface with the x-dsh-expert-council header.',
      'settings.hostWarnings': 'Host warnings',
      'settings.loadingState': 'Loading Expert Council state…',
      'settings.noSlots': 'The host reported no slots.',
      'settings.footer':
        'The Expert Council settings page talks to the host over /expert-council/* and never reads or writes any other plugin surface.',
      'settings.slotName': 'Slot {slot}',
      'settings.configured': 'configured',
      'settings.incomplete': 'incomplete',
      'settings.enabled': 'enabled',
      'settings.unsavedChanges': 'unsaved changes',
      'settings.enabledLabel': 'Enabled',
      'settings.enabledHint': 'Disabled slots are never contacted and are reported as DISABLED.',
      'settings.displayName': 'Display name',
      'settings.displayNameHint': 'Shown on consultation cards in the conversation.',
      'settings.displayNamePlaceholder': 'e.g. Frontier Reasoning',
      'settings.apiFormat': 'API format',
      'settings.apiFormatHint':
        'openai_chat_completions posts to /chat/completions; anthropic_messages posts to /messages.',
      'settings.providerName': 'Provider name',
      'settings.providerNameHint': 'Free-form label, e.g. the vendor name. Diagnostic only.',
      'settings.providerNamePlaceholder': 'e.g. Anthropic',
      'settings.baseUrl': 'Base URL',
      'settings.baseUrlHint': 'Scheme + host + optional path. A trailing /v1 is not duplicated.',
      'settings.modelId': 'Model ID',
      'settings.modelIdHint': 'Exact wire model identifier, e.g. model-id.',
      'settings.credential': 'Credential',
      'settings.credentialHint':
        'Reference: {reference}. Only the status is shown here; the secret value never leaves the host.',
      'settings.missing': 'missing',
      'settings.credentialSource': 'source: {source}',
      'settings.apiKey': 'API key',
      'settings.apiKeyHint': 'Write-only. Submitting stores it in the host credential store.',
      'settings.replaceKeyPlaceholder': 'Replace stored key…',
      'settings.pasteKeyPlaceholder': 'Paste API key…',
      'settings.saveKey': 'Save key',
      'settings.removeKey': 'Remove key',
      'settings.saving': 'Saving…',
      'settings.removing': 'Removing…',
      'settings.maxOutputTokens': 'Max output tokens',
      'settings.maxOutputTokensHint': 'Required by anthropic_messages; passed as max_tokens.',
      'settings.temperature': 'Temperature',
      'settings.temperatureHint': 'Leave empty to omit the field from the request.',
      'settings.temperaturePlaceholder': 'empty = omit',
      'settings.timeout': 'Timeout (ms)',
      'settings.timeoutHint': 'Whole request budget before the call is aborted.',
      'settings.retries': 'Retries',
      'settings.retriesHint': 'Only retryable failures (429, 5xx, network) are retried.',
      'settings.reasoningEffort': 'Reasoning effort',
      'settings.reasoningEffortHint': 'Passed to the provider as reasoning_effort; Anthropic receives an extended-thinking budget derived from it.',
      'settings.reasoningEffortOff': 'not sent (provider default)',
      'settings.reasoningEffortMax': 'max (highest)',
      'settings.thinkingBudget': 'Thinking budget (tokens)',
      'settings.thinkingBudgetHint': 'Anthropic only. Sets thinking.budget_tokens directly and overrides the effort-derived value; leave empty to derive it from the effort. Some gateways only honor this field.',
      'settings.thinkingBudgetInvalid': 'Thinking budget must be a positive whole number, or empty.',
      'settings.anthropicVersion': 'Anthropic version',
      'settings.anthropicVersionHint': 'Sent as the anthropic-version header.',
      'settings.authScheme': 'Auth scheme',
      'settings.authSchemeHint':
        'x-api-key sends the key in x-api-key; bearer sends Authorization: Bearer.',
      'settings.save': 'Save',
      'settings.testConnection': 'Test connection',
      'settings.testing': 'Testing…',
      'settings.testBillingWarning': 'Testing sends a real request and may be billed.',
      'settings.deleting': 'Deleting…',
      'settings.fieldRequired': '{label} is required.',
      'settings.fieldInteger': '{label} must be a whole number.',
      'settings.fieldMinimum': '{label} must be at least {minimum}.',
      'settings.temperatureInvalid': 'Temperature must be a non-negative number, or empty.',
      'settings.networkError': 'Network error: {message}',
      'settings.httpStatusLine': 'HTTP {status} {statusText}',
      'settings.requestFailed': '{message} (HTTP {status})',
      'settings.nonJsonResponse': 'The host returned a non-JSON response.',
      'settings.refused': 'The host refused the request.',
      'settings.saved': 'Saved. The host configuration was updated.',
      'settings.enterApiKey': 'Enter an API key first.',
      'settings.keyStored': 'API key stored. The value is never displayed again.',
      'settings.keyRemoved': 'Stored API key removed.',
      'settings.testOk': 'Test finished successfully.',
      'settings.testFailed': 'Test finished with a failure; see the details below.',
      'settings.noTestResult': 'The host returned no test result.',

      'host.title': 'Host storage & security',
      'host.storePath': 'Store path',
      'host.records': 'Records',
      'host.bytes': 'Bytes',
      'host.orphans': 'Orphans',
      'host.allowedHosts': 'Allowed hosts',
      'host.trustedLocalEndpoints': 'Trusted local endpoints',
      'host.maxPayload': 'Max payload',
      'host.redaction': 'Redaction',
      'host.repoScope': 'Repo scope',
      'host.refused': 'refused',

      'history.load': 'Load consultation history',
      'history.loading': 'Loading…',
      'history.hint':
        'Read-only listing of recorded consultations. Card rendering in the conversation never depends on it.',
      'history.empty': 'No consultations recorded yet.',
      'history.noQuestion': '(no question recorded)',
      'history.delete': 'Delete',

      'test.host': 'Host',
      'test.protocol': 'Protocol',
      'test.model': 'Model',
      'test.authOk': 'Auth ok',
      'test.nonStreamOk': 'Non-stream ok',
      'test.parseOk': 'Parse ok',
      'test.usageAvailable': 'Usage available',
      'test.latency': 'Latency',
      'test.billable': 'Billable',
      'test.yes': '✓ yes',
      'test.no': '✗ no',
      'test.billableYes': 'yes — a real request was sent',
      'test.errorStatus': '{text} (HTTP {status})',

      'error.category.SLOT_UNCONFIGURED': 'SLOT_UNCONFIGURED · the slot is not configured yet',
      'error.category.SLOT_DISABLED': 'SLOT_DISABLED · the slot is disabled',
      'error.category.CREDENTIAL_MISSING': 'CREDENTIAL_MISSING · no credential is available for the slot',
      'error.category.AUTH_REQUIRED': 'AUTH_REQUIRED · the provider requires authentication',
      'error.category.AUTH_INVALID': 'AUTH_INVALID · the provider rejected the credential',
      'error.category.ENDPOINT_NOT_ALLOWED': 'ENDPOINT_NOT_ALLOWED · the endpoint is not allowed',
      'error.category.INVALID_ENDPOINT': 'INVALID_ENDPOINT · the endpoint URL is invalid',
      'error.category.MODEL_UNAVAILABLE': 'MODEL_UNAVAILABLE · the model is not available',
      'error.category.RATE_LIMITED': 'RATE_LIMITED · the provider is rate limiting requests',
      'error.category.PROVIDER_UNAVAILABLE': 'PROVIDER_UNAVAILABLE · the provider is unavailable',
      'error.category.PROVIDER_ERROR': 'PROVIDER_ERROR · the provider returned an error',
      'error.category.EMPTY_RESPONSE': 'EMPTY_RESPONSE · the provider returned no text',
      'error.category.BAD_RESPONSE': 'BAD_RESPONSE · the response did not match the protocol',
      'error.category.TIMEOUT': 'TIMEOUT · the request exceeded its time budget',
      'error.category.CANCELLED': 'CANCELLED · the call was cancelled',
      'error.category.PAYLOAD_TOO_LARGE': 'PAYLOAD_TOO_LARGE · the payload exceeds the size limit',
      'error.category.DATA_APPROVAL_REQUIRED': 'DATA_APPROVAL_REQUIRED · sending this data needs approval',
      'error.category.COST_APPROVAL_REQUIRED': 'COST_APPROVAL_REQUIRED · the cost needs approval',
      'error.category.CAPABILITY_UNSUPPORTED': 'CAPABILITY_UNSUPPORTED · a required capability is missing',
      'error.category.NETWORK_ERROR': 'NETWORK_ERROR · the request failed at the network layer',
      'error.category.UNKNOWN': '{code} · unrecognised error category',
    }

    const MESSAGES_ZH = {
      'common.unknown': '未知',
      'common.unknownId': '未知 id',
      'common.unknownProtocol': '未知协议',
      'common.none': '无',
      'common.yes': '是',
      'common.no': '否',
      'common.empty': '（空）',
      'common.emptyResult': '（空结果）',
      'common.noAnswerInline': '（无回答正文）',
      'common.unnamed': '未命名',
      'common.noModel': '无模型',
      'common.copy': '复制',
      'common.copied': '已复制',
      'common.copyToClipboard': '复制到剪贴板',
      'common.copyJson': '复制 JSON',
      'common.show': '展开',
      'common.hide': '收起',
      'common.details': '详情',

      'unit.milliseconds': '{value} 毫秒',
      'unit.seconds': '{value} 秒',
      'unit.bytes': '{value} B',
      'unit.kilobytes': '{value} KB',
      'unit.megabytes': '{value} MB',
      'unit.chars': '{value} 字符',

      'protocol.anthropicMessages': 'Anthropic Messages',
      'protocol.openaiChatCompletions': 'OpenAI Chat Completions',

      'usage.unknown': '用量未知',
      'usage.input': '输入 {value}',
      'usage.output': '输出 {value}',
      'usage.total': '合计 {value}',
      'usage.cache': '缓存 {value}',
      'usage.reasoning': '推理 {value}',

      'tool.consultExpert': '专家咨询',
      'tool.consultCouncil': '专家委员会',
      'tool.followupExpert': '专家追问',
      'tool.verifyConsultation': '咨询验证',

      'card.titleSlot': '{title} · {slot}',
      'card.titleSlotName': '{title} · {slot} {name}',
      'card.councilTitle': '{title} · {slots}',
      'card.pendingPreparing': '正在准备咨询…',
      'card.pendingConsulting': '正在咨询外部专家模型…',
      'card.pendingWithSummary': '{label} — {summary}',
      'card.pendingNote': '本次调用尚未返回结果。',
      'card.copyAnswer': '复制回答',
      'card.copyReport': '复制报告',
      'card.inspect': '查看详情',
      'card.summaryTitle': '概要',
      'card.consultationId': '咨询 id',
      'card.status': '状态',
      'card.mode': '模式',
      'card.reason': '原因',
      'card.requestedOutput': '期望输出',
      'card.duration': '耗时',
      'card.requestedSlot': '指定档位',
      'card.autoRouted': '自动路由',
      'card.routingPolicy': '路由策略',
      'card.finishReason': '结束原因',
      'card.attempts': '尝试次数',
      'card.requestId': '请求 id',
      'card.questionTitle': '问题',
      'card.copyQuestion': '复制问题',
      'card.context': '上下文',
      'card.evidence': '证据',
      'card.questionHash': '问题哈希',
      'card.fullAnswer': '完整回答',
      'card.noAnswerSlot': '该档位没有记录回答正文。',
      'card.requestSystem': '系统提示',
      'card.requestUser': '用户消息',
      'card.requestHash': '请求哈希',
      'card.sentBytes': '发送字节',
      'card.requestTitle': '实际发送的脱敏请求',
      'card.copyRequest': '复制请求',
      'card.originalBytes': '原始字节',
      'card.rulesApplied': '命中规则',
      'card.redactions': '脱敏次数',
      'card.externalBytes': '外发字节',
      'card.truncated': '是否截断',
      'card.appliedRules': '应用规则',
      'card.redactionTitle': '脱敏',
      'card.configRevision': '配置版本',
      'card.diagnosticsTitle': '诊断',
      'card.diagnosticsNotes': '宿主诊断备注（原文）',
      'card.rawJsonTitle': '原始元数据（JSON）',
      'card.toolCallFailed': '工具调用失败',
      'card.toolCallFailedDetail': '宿主将本次咨询标记为错误。',
      'card.errorHttpStatus': 'HTTP 状态码',
      'card.errorProviderCode': '提供方错误码',
      'card.errorRetryable': '可重试',
      'card.returnedCount': '{success}/{requested} 已返回',
      'card.councilSubLine': '{returned} · {duration} · 成本 {cost}',
      'card.copyComparison': '复制三路对比',
      'card.questionSnapshotTitle': '问题（三路共享快照）',
      'card.synthesisTitle': '委员会综合',
      'card.synthesisSubtitle': '机械聚合 · 不是语义结论',
      'card.synthesisNote': '仅为词面机械重合，不代表事实一致，需主 Agent 独立验证。',
      'card.overlapTitle': '重合词项（词面）',
      'card.overlapEmpty': '各档位之间没有发现共同词项。',
      'card.uniqueBySlotTitle': '各档位独有内容',
      'card.uniqueEmpty': '没有记录各档位的独有内容。',
      'card.answerLengthsTitle': '回答长度',
      'card.noSynthesis': '本次委员会调用没有记录综合元数据。',
      'card.noModelConfigured': '未配置模型',
      'card.noAnswerRecorded': '没有记录回答正文。',
      'card.collapse': '收起',
      'card.expandAnswer': '展开回答',
      'card.noStructuredMeta': '无结构化元数据',
      'card.fallbackNote': '本次调用没有可用的结构化元数据，因此只显示原始工具结果文本。',
      'card.copyResultText': '复制结果文本',
      'card.recordedVerdictTitle': '已记录的判定',
      'card.copyNotes': '复制备注',
      'card.verdict': '判定',
      'card.recordedAt': '记录时间',
      'card.noVerdictDetails': '本次验证没有记录判定详情。',
      'card.decisionFallback': '判定',

      'report.singleHeader': '专家咨询 — {id}',
      'report.statusLine': '状态：{status} · 耗时：{duration}',
      'report.slotLine': '档位：{slot} {name} · {model} · {status} · {duration}',
      'report.protocolLine': '协议：{protocol} · 主机：{host}',
      'report.answerHeading': '--- 回答 ---',
      'report.councilHeader': '专家委员会 — {id}',
      'report.councilStatusLine': '状态：{status} · {returned} · 耗时 {duration}',
      'report.totalCost': '总成本：{cost}',
      'report.questionHeading': '--- 问题（三路共享快照）---',
      'report.slotHeading': '--- {slot} · {name} · {model} · {status} · 耗时 {duration} ---',
      'report.errorLine': '[错误] {category}：{message}',
      'report.synthesisHeading': '--- 机械综合（仅词面重合，不代表事实一致）---',
      'report.noSynthesis': '（无综合元数据）',
      'report.note': '说明：{note}',
      'report.overlap': '重合项：{value}',
      'report.uniqueBySlot': '各档位独有：{value}',
      'report.answerLengths': '回答长度：{value}',
      'report.answerLength': '{slot} {chars} 字符',
      'report.decision': '判定：{verdict} — {notes}',

      'settings.navLabel': '专家委员会',
      'settings.title': '专家委员会',
      'settings.description':
        '最多可配置三个外部专家模型档位。L1 为前沿推理档，L2 为进阶档，L3 为核心档。凭证由宿主保存，任何情况下都不会在这里显示。',
      'settings.refresh': '刷新',
      'settings.refreshing': '正在刷新…',
      'settings.defaultsLine': '默认：单档位 {slot} · 委员会 {council}',
      'settings.allowed': '允许',
      'settings.disabled': '已禁用',
      'settings.stateVersion': '状态版本 {version}',
      'settings.loadFailed': '无法加载专家委员会状态：{message}',
      'settings.loadFailedHint':
        '设置路由只在回环地址上、且携带 x-dsh-expert-council 请求头时才会响应。',
      'settings.hostWarnings': '宿主警告',
      'settings.loadingState': '正在加载专家委员会状态…',
      'settings.noSlots': '宿主没有报告任何档位。',
      'settings.footer':
        '专家委员会设置页只通过 /expert-council/* 与宿主通信，不读写其他插件的任何界面。',
      'settings.slotName': '档位 {slot}',
      'settings.configured': '已配置',
      'settings.incomplete': '未完成',
      'settings.enabled': '已启用',
      'settings.unsavedChanges': '有未保存的修改',
      'settings.enabledLabel': '启用',
      'settings.enabledHint': '禁用的档位不会被调用，并会以 DISABLED 状态上报。',
      'settings.displayName': '显示名称',
      'settings.displayNameHint': '显示在会话中的咨询卡片上。',
      'settings.displayNamePlaceholder': '例如 Frontier Reasoning',
      'settings.apiFormat': 'API 格式',
      'settings.apiFormatHint':
        'openai_chat_completions 请求 /chat/completions；anthropic_messages 请求 /messages。',
      'settings.providerName': '提供方名称',
      'settings.providerNameHint': '自由文本标签，例如厂商名。仅用于诊断。',
      'settings.providerNamePlaceholder': '例如 Anthropic',
      'settings.baseUrl': 'Base URL',
      'settings.baseUrlHint': '协议 + 主机 + 可选路径。末尾的 /v1 不会被重复拼接。',
      'settings.modelId': 'Model ID',
      'settings.modelIdHint': '精确的模型标识符，例如 model-id。',
      'settings.credential': '凭证',
      'settings.credentialHint':
        '引用名：{reference}。此处只显示状态，密钥本身不会离开宿主。',
      'settings.missing': '缺失',
      'settings.credentialSource': '来源：{source}',
      'settings.apiKey': 'API key',
      'settings.apiKeyHint': '只写字段。提交后由宿主凭证库保存。',
      'settings.replaceKeyPlaceholder': '替换已保存的密钥…',
      'settings.pasteKeyPlaceholder': '粘贴 API key…',
      'settings.saveKey': '保存密钥',
      'settings.removeKey': '移除密钥',
      'settings.saving': '正在保存…',
      'settings.removing': '正在移除…',
      'settings.maxOutputTokens': '最大输出 Token 数',
      'settings.maxOutputTokensHint': 'anthropic_messages 必填；以 max_tokens 字段发送。',
      'settings.temperature': 'Temperature（采样温度）',
      'settings.temperatureHint': '留空则请求中不带该字段。',
      'settings.temperaturePlaceholder': '留空 = 省略',
      'settings.timeout': '超时（毫秒）',
      'settings.timeoutHint': '整个请求的时间预算，超时后调用会被中止。',
      'settings.retries': '重试次数',
      'settings.retriesHint': '只有可重试的失败（429、5xx、网络错误）才会重试。',
      'settings.reasoningEffort': '思考等级',
      'settings.reasoningEffortHint': '以 reasoning_effort 发送给供应商；Anthropic 会据此换算扩展思考预算。',
      'settings.reasoningEffortOff': '不发送（用供应商默认）',
      'settings.reasoningEffortMax': 'max（最高）',
      'settings.thinkingBudget': '思考预算（token）',
      'settings.thinkingBudgetHint': '仅 Anthropic。直接设置 thinking.budget_tokens，并覆盖由思考等级换算的值；留空则按等级换算。某些网关只认这个字段。',
      'settings.thinkingBudgetInvalid': '思考预算必须是正整数，或留空。',
      'settings.anthropicVersion': 'Anthropic 版本',
      'settings.anthropicVersionHint': '以 anthropic-version 请求头发送。',
      'settings.authScheme': '鉴权方式',
      'settings.authSchemeHint':
        'x-api-key 通过 x-api-key 请求头传密钥；bearer 通过 Authorization: Bearer 传密钥。',
      'settings.save': '保存',
      'settings.testConnection': '测试连接',
      'settings.testing': '正在测试…',
      'settings.testBillingWarning': '测试会发送真实请求，可能产生费用。',
      'settings.deleting': '正在删除…',
      'settings.fieldRequired': '{label}为必填项。',
      'settings.fieldInteger': '{label}必须是整数。',
      'settings.fieldMinimum': '{label}不能小于 {minimum}。',
      'settings.temperatureInvalid': 'Temperature 必须是非负数，或留空。',
      'settings.networkError': '网络错误：{message}',
      'settings.httpStatusLine': 'HTTP {status} {statusText}',
      'settings.requestFailed': '{message}（HTTP {status}）',
      'settings.nonJsonResponse': '宿主返回了非 JSON 响应。',
      'settings.refused': '宿主拒绝了该请求。',
      'settings.saved': '已保存。宿主配置已更新。',
      'settings.enterApiKey': '请先填写 API key。',
      'settings.keyStored': 'API key 已保存，之后不会再显示该值。',
      'settings.keyRemoved': '已移除保存的 API key。',
      'settings.testOk': '测试成功完成。',
      'settings.testFailed': '测试失败，详情见下方。',
      'settings.noTestResult': '宿主没有返回测试结果。',

      'host.title': '宿主存储与安全',
      'host.storePath': '存储路径',
      'host.records': '记录数',
      'host.bytes': '字节数',
      'host.orphans': '孤立记录',
      'host.allowedHosts': '允许的主机',
      'host.trustedLocalEndpoints': '受信任的本地端点',
      'host.maxPayload': '最大负载',
      'host.redaction': '脱敏',
      'host.repoScope': '仓库作用域',
      'host.refused': '拒绝',

      'history.load': '加载咨询历史',
      'history.loading': '正在加载…',
      'history.hint': '只读列出已记录的咨询。会话中的卡片渲染不依赖它。',
      'history.empty': '还没有记录任何咨询。',
      'history.noQuestion': '（未记录问题）',
      'history.delete': '删除',

      'test.host': '主机',
      'test.protocol': '协议',
      'test.model': '模型',
      'test.authOk': '鉴权通过',
      'test.nonStreamOk': '非流式通过',
      'test.parseOk': '解析通过',
      'test.usageAvailable': '有用量信息',
      'test.latency': '延迟',
      'test.billable': '是否计费',
      'test.yes': '✓ 是',
      'test.no': '✗ 否',
      'test.billableYes': '是 — 已发送真实请求',
      'test.errorStatus': '{text}（HTTP {status}）',

      'error.category.SLOT_UNCONFIGURED': 'SLOT_UNCONFIGURED · 该档位尚未配置',
      'error.category.SLOT_DISABLED': 'SLOT_DISABLED · 该档位已禁用',
      'error.category.CREDENTIAL_MISSING': 'CREDENTIAL_MISSING · 该档位没有可用凭证',
      'error.category.AUTH_REQUIRED': 'AUTH_REQUIRED · 提供方要求身份验证',
      'error.category.AUTH_INVALID': 'AUTH_INVALID · 提供方拒绝了该凭证',
      'error.category.ENDPOINT_NOT_ALLOWED': 'ENDPOINT_NOT_ALLOWED · 该端点不在允许范围内',
      'error.category.INVALID_ENDPOINT': 'INVALID_ENDPOINT · 端点 URL 无效',
      'error.category.MODEL_UNAVAILABLE': 'MODEL_UNAVAILABLE · 该模型不可用',
      'error.category.RATE_LIMITED': 'RATE_LIMITED · 提供方限流，请求过于频繁',
      'error.category.PROVIDER_UNAVAILABLE': 'PROVIDER_UNAVAILABLE · 提供方不可用',
      'error.category.PROVIDER_ERROR': 'PROVIDER_ERROR · 提供方返回错误',
      'error.category.EMPTY_RESPONSE': 'EMPTY_RESPONSE · 提供方没有返回正文',
      'error.category.BAD_RESPONSE': 'BAD_RESPONSE · 响应与协议不匹配',
      'error.category.TIMEOUT': 'TIMEOUT · 请求超出时间预算',
      'error.category.CANCELLED': 'CANCELLED · 调用被取消',
      'error.category.PAYLOAD_TOO_LARGE': 'PAYLOAD_TOO_LARGE · 正文超出大小上限',
      'error.category.DATA_APPROVAL_REQUIRED': 'DATA_APPROVAL_REQUIRED · 外发这些数据需要批准',
      'error.category.COST_APPROVAL_REQUIRED': 'COST_APPROVAL_REQUIRED · 成本超出预算需要批准',
      'error.category.CAPABILITY_UNSUPPORTED': 'CAPABILITY_UNSUPPORTED · 缺少所需能力',
      'error.category.NETWORK_ERROR': 'NETWORK_ERROR · 请求在网络层失败',
      'error.category.UNKNOWN': '{code} · 未识别的错误类别',
    }

    // Locale bindings, filled in by `apply()`. Kept module-level (inside the
    // factory closure) so every render path — including pure helpers such as
    // formatDuration and the clipboard report builders — can localize.
    //
    // The locale service is attached LAZILY. A client plugin activates as soon
    // as its own `inject` list is satisfied, which can happen BEFORE the locale
    // service registers; capturing `ctx.get('locale')` once at apply() time
    // therefore froze the English fallback forever when locale arrived second.
    // `attachLocale` is idempotent and `t()` retries resolution on every call.
    let boundTranslate = null
    let subscribeLocale = null
    let readActiveLocale = null
    let activeLocale = null
    let localeAttached = false
    let resolveLocaleService = null
    // Mounted entry components register their resubscribe hook here, so a locale
    // service that activates after the first render still reaches the UI.
    const localeListeners = new Set()

    function readActiveFrom(service) {
      if (typeof service.getLocale !== 'function') return null
      try {
        const snapshot = service.getLocale()
        return snapshot !== null && snapshot !== undefined && typeof snapshot.active === 'string' ? snapshot.active : null
      } catch (error) {
        return null
      }
    }

    /**
     * Whether the browser itself asks for Chinese. Used only as the last-resort
     * dictionary choice when no locale service is available; the host's own
     * preference always wins when it exists.
     * @returns {boolean}
     */
    function browserPrefersChinese() {
      try {
        const nav = typeof navigator === 'undefined' ? null : navigator
        if (nav === null || nav === undefined) return false
        const list = Array.isArray(nav.languages) && nav.languages.length > 0
          ? nav.languages
          : typeof nav.language === 'string' && nav.language !== ''
            ? [nav.language]
            : []
        for (const tag of list) {
          if (typeof tag !== 'string' || tag === '') continue
          // The first tag decides: a user whose primary language is English is
          // not served Chinese just because Chinese is a secondary preference.
          return tag.toLowerCase().startsWith('zh')
        }
        return false
      } catch (error) {
        return false
      }
    }

    /**
     * Bind the locale service once. Safe to call repeatedly; later calls are
     * no-ops. Notifies every mounted entry so an already rendered card picks up
     * the dictionaries that were just registered.
     * @returns whether a service is bound after this call.
     */
    function attachLocale(service) {
      if (localeAttached) return true
      if (service === null || service === undefined || typeof service.bind !== 'function') return false
      localeAttached = true
      try {
        boundTranslate = service.bind(NAMESPACE)
      } catch (error) {
        boundTranslate = null
      }
      subscribeLocale =
        typeof service.subscribe === 'function'
          ? function subscribe(listener) {
              return service.subscribe(listener)
            }
          : null
      readActiveLocale =
        typeof service.getLocale === 'function'
          ? function readLocale() {
              return readActiveFrom(service)
            }
          : null
      activeLocale = readActiveLocale === null ? null : readActiveLocale()
      for (const listener of Array.from(localeListeners)) {
        try {
          listener()
        } catch (error) {
          // one bad listener must not stop the others
        }
      }
      return true
    }

    /**
     * Resolve the locale service right now, attaching it on first success.
     * Called from `t()` so a plugin that rendered before the service existed
     * recovers on its next render instead of staying English forever.
     */
    function ensureLocale() {
      if (localeAttached) return true
      if (typeof resolveLocaleService !== 'function') return false
      let service = null
      try {
        service = resolveLocaleService()
      } catch (error) {
        return false
      }
      return attachLocale(service)
    }

    function interpolate(template, params) {
      if (params === null || params === undefined) return String(template)
      return String(template).replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
      })
    }

    // Never returns a bare key: without a locale service the built-in English
    // dictionary is used, so a host without `ctx.locale` still shows real copy.
    function t(key, params) {
      // Late attachment: the first render may happen before the locale service
      // registers, so retry the resolution here rather than only in apply().
      if (!localeAttached) ensureLocale()
      if (typeof boundTranslate === 'function') {
        let translated = null
        try {
          translated = boundTranslate(key, params)
        } catch (error) {
          translated = null
        }
        if (typeof translated === 'string' && translated !== '' && translated !== key) return translated
      }
      // The host locale service is authoritative. When it never arrives — an
      // older host, a profile without it, or a plugin that activated first and
      // was never re-notified — fall back to what the browser itself asks for,
      // so a Chinese user is not left on English copy.
      const dictionary = browserPrefersChinese() ? MESSAGES_ZH : MESSAGES_EN
      const fallback = dictionary[key]
      if (typeof fallback === 'string') return interpolate(fallback, params)
      const secondary = dictionary === MESSAGES_ZH ? MESSAGES_EN[key] : MESSAGES_ZH[key]
      if (typeof secondary === 'string') return interpolate(secondary, params)
      return String(key)
    }

    // Error categories are stable machine codes: the card leads with a
    // localized explanation while keeping the code itself readable, and the
    // host message stays available as secondary diagnostic text.
    function errorCategoryText(code) {
      switch (code) {
        case 'SLOT_UNCONFIGURED':
          return t('error.category.SLOT_UNCONFIGURED')
        case 'SLOT_DISABLED':
          return t('error.category.SLOT_DISABLED')
        case 'CREDENTIAL_MISSING':
          return t('error.category.CREDENTIAL_MISSING')
        case 'AUTH_REQUIRED':
          return t('error.category.AUTH_REQUIRED')
        case 'AUTH_INVALID':
          return t('error.category.AUTH_INVALID')
        case 'ENDPOINT_NOT_ALLOWED':
          return t('error.category.ENDPOINT_NOT_ALLOWED')
        case 'INVALID_ENDPOINT':
          return t('error.category.INVALID_ENDPOINT')
        case 'MODEL_UNAVAILABLE':
          return t('error.category.MODEL_UNAVAILABLE')
        case 'RATE_LIMITED':
          return t('error.category.RATE_LIMITED')
        case 'PROVIDER_UNAVAILABLE':
          return t('error.category.PROVIDER_UNAVAILABLE')
        case 'PROVIDER_ERROR':
          return t('error.category.PROVIDER_ERROR')
        case 'EMPTY_RESPONSE':
          return t('error.category.EMPTY_RESPONSE')
        case 'BAD_RESPONSE':
          return t('error.category.BAD_RESPONSE')
        case 'TIMEOUT':
          return t('error.category.TIMEOUT')
        case 'CANCELLED':
          return t('error.category.CANCELLED')
        case 'PAYLOAD_TOO_LARGE':
          return t('error.category.PAYLOAD_TOO_LARGE')
        case 'DATA_APPROVAL_REQUIRED':
          return t('error.category.DATA_APPROVAL_REQUIRED')
        case 'COST_APPROVAL_REQUIRED':
          return t('error.category.COST_APPROVAL_REQUIRED')
        case 'CAPABILITY_UNSUPPORTED':
          return t('error.category.CAPABILITY_UNSUPPORTED')
        case 'NETWORK_ERROR':
          return t('error.category.NETWORK_ERROR')
        default:
          return t('error.category.UNKNOWN', { code: typeof code === 'string' && code !== '' ? code : 'UNKNOWN' })
      }
    }

    // Subscribed once per entry component: a locale switch forces one re-render
    // of the whole subtree, so child components never need their own listener.
    // The listener is also registered module-wide, because the locale service may
    // attach after this component mounted — in that case `attachLocale` calls
    // back into `resubscribe`, which subscribes and forces one render.
    function useLocaleRevision() {
      const state = useState(0)
      const revision = state[0]
      const setRevision = state[1]
      const bumpRef = useRef(null)
      bumpRef.current = function bumpNow() {
        setRevision(function bump(value) {
          return value + 1
        })
      }
      useEffect(function () {
        let live = true
        let unsubscribe = null

        function onLocaleChange() {
          if (!live) return
          if (readActiveLocale !== null) activeLocale = readActiveLocale()
          bumpRef.current()
        }

        function resubscribe() {
          if (!live) return
          if (unsubscribe !== null) {
            try {
              unsubscribe()
            } catch (error) {
              // already gone
            }
            unsubscribe = null
          }
          if (typeof subscribeLocale === 'function') {
            try {
              unsubscribe = subscribeLocale(onLocaleChange)
            } catch (error) {
              unsubscribe = null
            }
          }
          // Force one render so the dictionaries bound a moment ago are used.
          bumpRef.current()
        }

        localeListeners.add(resubscribe)
        resubscribe()

        return function cleanup() {
          live = false
          localeListeners.delete(resubscribe)
          if (typeof unsubscribe === 'function') unsubscribe()
        }
      }, [])
      return revision
    }

    // ------------------------------------------------------------------
    // Styles (injected once, removed on dispose)
    // ------------------------------------------------------------------

    const STYLE_ATTR = 'data-plugin'
    const STYLE_VALUE = 'dsh-expert-council'

    const CSS = `
.ec-root{display:flex;flex-direction:column;gap:4px;padding:2px 0 4px 0;color:var(--dsw-alias-label-primary);font-family:inherit;min-width:0}
.ec-head{display:flex;align-items:center;gap:6px;min-width:0;box-sizing:border-box;border-radius:var(--dsw-radius-sm,6px);padding:1px 6px 1px 2px;margin-left:-2px;cursor:pointer;background:transparent;border:none;font-family:inherit;text-align:left;width:100%}
.ec-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.10))}
.ec-chev{flex:none;width:12px;height:12px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,inherit);font-size:9px;line-height:1;transition:transform .12s ease}
.ec-chev[data-open="true"]{transform:rotate(90deg)}
.ec-title{flex:none;font-size:13px;line-height:22px;color:var(--dsw-alias-label-primary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(62%,460px)}
.ec-sub{flex:1 1 auto;min-width:0;font-size:12px;line-height:22px;color:var(--dsw-alias-label-tertiary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ec-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,currentColor);margin:0 2px}
.ec-dot[data-tone="ok"]{background:var(--dsw-alias-state-success-primary,currentColor)}
.ec-dot[data-tone="warn"]{background:var(--dsw-alias-state-warn-primary,currentColor)}
.ec-dot[data-tone="error"]{background:var(--dsw-alias-state-error-primary,currentColor)}
.ec-badge{flex:none;display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:0 7px;font-size:11px;line-height:18px;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));color:var(--dsw-alias-label-secondary,inherit);background:transparent;white-space:nowrap;font-variant-numeric:tabular-nums}
.ec-badge[data-tone="ok"]{color:var(--dsw-alias-state-success-primary,currentColor);border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary,#2f9e44) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#2f9e44) 8%, transparent)}
.ec-badge[data-tone="warn"]{color:var(--dsw-alias-state-warn-label,currentColor);border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#e8a33d) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#e8a33d) 10%, transparent)}
.ec-badge[data-tone="error"]{color:var(--dsw-alias-state-error-primary,currentColor);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#e03131) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#e03131) 8%, transparent)}
.ec-badge[data-tone="muted"]{color:var(--dsw-alias-label-caption,currentColor);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.25))}
.ec-body{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-1,transparent);padding:12px 14px;margin:4px 0 2px 0;min-width:0}
.ec-section{display:flex;flex-direction:column;gap:6px;min-width:0}
.ec-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.ec-label{font-size:11px;line-height:16px;letter-spacing:.03em;text-transform:uppercase;color:var(--dsw-alias-label-caption,inherit);font-weight:500}
.ec-kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:2px 12px;margin:0;font-size:12px;line-height:18px}
.ec-kv dt{color:var(--dsw-alias-label-tertiary,inherit);white-space:nowrap}
.ec-kv dd{margin:0;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere;min-width:0}
.ec-pre{margin:0;font-family:var(--dsw-font-markdown-code-block-small,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-alias-markdown-code-block,rgba(127,127,127,.08));border-radius:var(--dsw-radius-sm,6px);padding:8px 10px;max-height:300px;overflow:auto;color:var(--dsw-alias-label-secondary,inherit)}
.ec-pre[data-tall="true"]{max-height:520px}
.ec-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.ec-btn{display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-secondary,inherit);font-family:inherit;font-size:11px;line-height:18px;padding:1px 8px;cursor:pointer;white-space:nowrap}
.ec-btn:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,inherit)}
.ec-btn:disabled{opacity:.5;cursor:default}
.ec-btn[data-variant="primary"]{background:var(--dsw-alias-button-primary-fill,#2f6feb);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
.ec-btn[data-variant="primary"]:hover{background:var(--dsw-alias-button-primary-hover,#2559c4);color:var(--dsw-alias-label-primary-foreground,#fff)}
.ec-btn[data-tone="error"]{color:var(--dsw-alias-state-error-primary,currentColor)}
.ec-council{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;min-width:0}
.ec-tabs{display:none;gap:4px;flex-wrap:wrap;margin-bottom:2px}
.ec-tab{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font-family:inherit;font-size:11px;line-height:18px;padding:1px 10px;cursor:pointer}
.ec-tab[data-active="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18));color:var(--dsw-alias-label-primary,inherit);border-color:var(--dsw-alias-border-l4,rgba(127,127,127,.45))}
@media (max-width:760px){
  .ec-council{grid-template-columns:minmax(0,1fr)}
  .ec-tabs{display:flex}
  .ec-panel[data-narrow-hidden="true"]{display:none}
}
.ec-panel{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-base,transparent);padding:8px 10px;min-width:0}
.ec-panel[data-tone="error"]{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#e03131) 45%, transparent)}
.ec-panel[data-tone="warn"]{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#e8a33d) 45%, transparent)}
.ec-panel-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.ec-slotbadge{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:22px;border-radius:var(--dsw-radius-sm,6px);padding:0 5px;font-size:11px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16));border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25))}
.ec-model{flex:1 1 auto;min-width:0;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--dsw-font-markdown-code-block-small,ui-monospace,monospace)}
.ec-answer{font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary,inherit);overflow:hidden;min-width:0}
.ec-answer[data-collapsed="true"]{max-height:168px;-webkit-mask-image:linear-gradient(180deg,#000 70%,transparent 100%);mask-image:linear-gradient(180deg,#000 70%,transparent 100%)}
.ec-synth{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2,transparent);padding:10px 12px;min-width:0}
.ec-chips{display:flex;flex-wrap:wrap;gap:4px;min-width:0}
.ec-chip{display:inline-flex;align-items:center;gap:4px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:var(--dsw-alias-bg-base,transparent);padding:0 6px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);font-family:var(--dsw-font-markdown-code-block-small,ui-monospace,monospace);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ec-chip[data-kind="number"]{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary,#4c6ef5) 40%, transparent);color:var(--dsw-alias-state-business-primary,currentColor)}
.ec-chip[data-kind="formula"]{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#e8a33d) 40%, transparent);color:var(--dsw-alias-state-warn-label,currentColor)}
.ec-warnbox{display:flex;gap:6px;align-items:flex-start;box-sizing:border-box;border-radius:var(--dsw-radius-sm,6px);border:.5px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary,#e8a33d) 45%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#e8a33d) 10%, transparent);padding:6px 8px;font-size:11px;line-height:17px;color:var(--dsw-alias-state-warn-label,inherit)}
.ec-errbox{display:flex;flex-direction:column;gap:4px;box-sizing:border-box;border-radius:var(--dsw-radius-sm,6px);border:.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary,#e03131) 45%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#e03131) 8%, transparent);padding:6px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);min-width:0}
.ec-errbox strong{color:var(--dsw-alias-state-error-primary,inherit);font-weight:600}
.ec-note{font-size:11px;line-height:17px;color:var(--dsw-alias-label-caption,inherit)}
.ec-pending{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;line-height:22px;color:var(--dsw-alias-label-secondary,inherit);padding:1px 2px}
.ec-pulse{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary,currentColor);animation:ec-pulse 1.2s ease-in-out infinite}
@keyframes ec-pulse{0%,100%{opacity:.25;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.ec-pulse{animation:none}.ec-chev{transition:none}}
.ec-fallback{display:flex;flex-direction:column;gap:6px;min-width:0}
.ec-mono{font-family:var(--dsw-font-markdown-code-block-small,ui-monospace,monospace)}
.ec-divider{height:.5px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.25));flex:none}
.ecs-page{display:flex;flex-direction:column;gap:18px;width:100%;min-width:0;color:var(--dsw-alias-label-primary,inherit);font-family:inherit;padding-bottom:8px}
.ecs-header{display:flex;flex-direction:column;gap:4px;min-width:0}
.ecs-title{font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.ecs-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit)}
.ecs-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ecs-card{display:flex;flex-direction:column;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-settings-card-fill,transparent);padding:0 16px;min-width:0}
.ecs-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:14px 0 12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));min-width:0}
.ecs-slot{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:26px;border-radius:var(--dsw-radius-sm,6px);padding:0 6px;font-size:12px;line-height:20px;font-weight:600;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16));border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25))}
.ecs-card-title{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ecs-row{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));min-width:0}
.ecs-row:last-child{border-bottom:none}
.ecs-row-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.ecs-row-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary,inherit)}
.ecs-row-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere}
.ecs-control{flex:0 0 auto;display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;justify-content:flex-end}
.ecs-input{box-sizing:border-box;font-family:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-base,transparent);border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:var(--dsw-radius-sm,6px);padding:5px 8px;min-width:0;outline:none}
.ecs-input::placeholder{color:var(--dsw-alias-label-caption,inherit)}
.ecs-input:focus{border-color:var(--dsw-alias-border-l4,rgba(127,127,127,.5));box-shadow:0 0 0 2px var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.ecs-input:disabled{opacity:.55}
.ecs-input[data-width="wide"]{width:360px;max-width:100%}
.ecs-input[data-width="mid"]{width:200px;max-width:100%}
.ecs-input[data-width="narrow"]{width:104px}
.ecs-select{box-sizing:border-box;font-family:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-base,transparent);border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:var(--dsw-radius-sm,6px);padding:5px 8px;min-width:0;outline:none;width:220px;max-width:100%}
.ecs-check{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary,#2f6feb);cursor:pointer;flex:none}
.ecs-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 0 14px 0;border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25))}
.ecs-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:5px;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:12px;line-height:20px;padding:3px 12px;cursor:pointer;white-space:nowrap}
.ecs-btn:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.14))}
.ecs-btn:disabled{opacity:.5;cursor:default}
.ecs-btn[data-variant="primary"]{background:var(--dsw-alias-button-primary-fill,#2f6feb);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
.ecs-btn[data-variant="primary"]:hover{background:var(--dsw-alias-button-primary-hover,#2559c4)}
.ecs-note{display:flex;align-items:flex-start;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);min-width:0;overflow-wrap:anywhere}
.ecs-note[data-kind="ok"]{color:var(--dsw-alias-state-success-primary,currentColor)}
.ecs-note[data-kind="error"]{color:var(--dsw-alias-state-error-primary,currentColor)}
.ecs-note[data-kind="warn"]{color:var(--dsw-alias-state-warn-label,currentColor)}
.ecs-banner{display:flex;flex-direction:column;gap:4px;box-sizing:border-box;border-radius:var(--dsw-radius-md,8px);border:.5px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary,#e8a33d) 45%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#e8a33d) 10%, transparent);padding:8px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit)}
.ecs-test{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px 14px;margin:0;font-size:12px;line-height:18px;box-sizing:border-box;border-radius:var(--dsw-radius-md,8px);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:var(--dsw-alias-bg-layer-2,transparent);padding:8px 10px;width:100%}
.ecs-test dt{color:var(--dsw-alias-label-tertiary,inherit);font-size:11px;line-height:16px}
.ecs-test dd{margin:0;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.ecs-empty{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,inherit);padding:12px 0}
.ecs-hint{font-size:11px;line-height:17px;color:var(--dsw-alias-label-caption,inherit)}
`

    function installStyles() {
      if (typeof document === 'undefined' || document.head === null) return function () {}
      let tag = document.querySelector('style[' + STYLE_ATTR + '="' + STYLE_VALUE + '"]')
      if (tag === null) {
        tag = document.createElement('style')
        tag.setAttribute(STYLE_ATTR, STYLE_VALUE)
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
      return function disposeStyles() {
        try {
          if (tag !== null && tag.parentNode !== null) tag.parentNode.removeChild(tag)
        } catch (error) {
          /* the document may already be tearing down */
        }
      }
    }

    // ------------------------------------------------------------------
    // Defensive value readers (never throw on malformed meta)
    // ------------------------------------------------------------------

    const SLOT_IDS = ['L1', 'L2', 'L3']

    function isRecord(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    function asRecord(value) {
      return isRecord(value) ? value : null
    }

    function asString(value) {
      return typeof value === 'string' ? value : null
    }

    function asNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }

    function asBoolean(value) {
      return typeof value === 'boolean' ? value : null
    }

    function asArray(value) {
      return Array.isArray(value) ? value : []
    }

    function strings(value) {
      return asArray(value).filter(function (item) {
        return typeof item === 'string'
      })
    }

    function slotIds(value) {
      return asArray(value).filter(function (item) {
        return SLOT_IDS.indexOf(item) >= 0
      })
    }

    // ------------------------------------------------------------------
    // Formatting
    // ------------------------------------------------------------------

    function formatDuration(ms) {
      const value = asNumber(ms)
      if (value === null) return t('common.unknown')
      if (value < 1000) return t('unit.milliseconds', { value: Math.round(value) })
      return t('unit.seconds', { value: (value / 1000).toFixed(value < 10000 ? 2 : 1) })
    }

    function groupDigits(value) {
      const text = String(Math.round(value))
      let out = ''
      for (let index = 0; index < text.length; index += 1) {
        if (index > 0 && (text.length - index) % 3 === 0) out += ','
        out += text.charAt(index)
      }
      return out
    }

    function formatTokens(value) {
      const number = asNumber(value)
      return number === null ? t('common.unknown') : groupDigits(number)
    }

    function formatUsdAmount(amount) {
      if (amount >= 1) return amount.toFixed(2)
      // Sub-dollar amounts keep at least two decimals and never lose precision
      // for genuinely tiny per-call costs.
      return amount.toFixed(4).replace(/(\.\d\d)0+$/, '$1')
    }

    function formatCost(cost) {
      const record = asRecord(cost)
      const amount = record === null ? null : asNumber(record.estimatedUsd)
      if (amount === null) return t('common.unknown')
      const source = asString(record.source)
      const prefix = source === 'estimated' ? '~$' : '$'
      return prefix + formatUsdAmount(amount)
    }

    function formatBytes(value) {
      const bytes = asNumber(value)
      if (bytes === null) return t('common.unknown')
      if (bytes < 1024) return t('unit.bytes', { value: bytes })
      if (bytes < 1024 * 1024) return t('unit.kilobytes', { value: (bytes / 1024).toFixed(1) })
      return t('unit.megabytes', { value: (bytes / (1024 * 1024)).toFixed(2) })
    }

    function formatPercent(part, total) {
      const a = asNumber(part)
      const b = asNumber(total)
      if (a === null || b === null || b <= 0) return t('common.unknown')
      return Math.round((a / b) * 100) + '%'
    }

    function toneOfStatus(status) {
      switch (status) {
        case 'SUCCESS':
        case 'COMPLETE':
        case 'ADOPTED':
          return 'ok'
        case 'PARTIAL':
        case 'NEEDS_MORE_EVIDENCE':
        case 'TIMEOUT':
        case 'CANCELLED':
          return 'warn'
        case 'ERROR':
        case 'FAILED':
        case 'REJECTED':
          return 'error'
        default:
          return 'muted'
      }
    }

    function protocolLabel(protocol) {
      if (protocol === 'anthropic_messages') return t('protocol.anthropicMessages')
      if (protocol === 'openai_chat_completions') return t('protocol.openaiChatCompletions')
      return protocol === null || protocol === '' ? t('common.unknownProtocol') : protocol
    }

    function toolTitle(toolName) {
      switch (toolName) {
        case 'consult_expert':
          return t('tool.consultExpert')
        case 'consult_council':
          return t('tool.consultCouncil')
        case 'followup_expert':
          return t('tool.followupExpert')
        case 'verify_consultation':
          return t('tool.verifyConsultation')
        default:
          return t('tool.consultCouncil')
      }
    }

    // ------------------------------------------------------------------
    // Meta normalization (defensive; unknown shapes degrade to generic text)
    // ------------------------------------------------------------------

    function normalizeUsage(value) {
      const record = asRecord(value)
      return {
        inputTokens: record === null ? null : asNumber(record.inputTokens),
        outputTokens: record === null ? null : asNumber(record.outputTokens),
        totalTokens: record === null ? null : asNumber(record.totalTokens),
        cacheReadTokens: record === null ? null : asNumber(record.cacheReadTokens),
        reasoningTokens: record === null ? null : asNumber(record.reasoningTokens),
      }
    }

    function normalizeError(value) {
      const record = asRecord(value)
      if (record === null) return null
      return {
        category: asString(record.category),
        message: asString(record.message),
        httpStatus: asNumber(record.httpStatus),
        providerCode: asString(record.providerCode),
        requestId: asString(record.requestId),
        retryable: asBoolean(record.retryable),
      }
    }

    function normalizeBlocks(value) {
      return asArray(value)
        .map(function (item) {
          const record = asRecord(item)
          if (record === null) return null
          const text = asString(record.text)
          if (text === null) return null
          return { type: asString(record.type) || 'text', text: text }
        })
        .filter(Boolean)
    }

    function normalizeSlotMeta(value) {
      const record = asRecord(value)
      if (record === null) return null
      const requestSent = asRecord(record.requestSent)
      const redactionDiff = asRecord(record.redactionDiff)
      const capabilities = asRecord(record.capabilities)
      const blocks = normalizeBlocks(record.blocks)
      let answer = asString(record.answer)
      if (answer === null && blocks.length > 0) {
        answer = blocks
          .map(function (block) {
            return block.text
          })
          .join('\n\n')
      }
      return {
        slot: asString(record.slot) || '?',
        displayName: asString(record.displayName) || '',
        protocol: asString(record.protocol) || '',
        providerLabel: asString(record.providerLabel) || '',
        endpointHost: asString(record.endpointHost) || '',
        modelId: asString(record.modelId) || '',
        status: asString(record.status) || 'UNKNOWN',
        error: normalizeError(record.error),
        requestId: asString(record.requestId),
        startedAt: asString(record.startedAt),
        durationMs: asNumber(record.durationMs),
        attempts: asNumber(record.attempts),
        usage: normalizeUsage(record.usage),
        cost: {
          estimatedUsd: asRecord(record.cost) === null ? null : asNumber(asRecord(record.cost).estimatedUsd),
          source: asRecord(record.cost) === null ? 'unknown' : asString(asRecord(record.cost).source) || 'unknown',
        },
        finishReason: asString(record.finishReason),
        answer: answer,
        blocks: blocks,
        requestSent:
          requestSent === null
            ? null
            : {
                system: asString(requestSent.system),
                user: asString(requestSent.user) || '',
                hash: asString(requestSent.hash),
                bytes: asNumber(requestSent.bytes),
              },
        capabilities: capabilities === null ? {} : capabilities,
        redactionDiff:
          redactionDiff === null
            ? null
            : {
                originalBytes: asNumber(redactionDiff.originalBytes),
                sentBytes: asNumber(redactionDiff.sentBytes),
                rules: strings(redactionDiff.rules),
              },
      }
    }

    function normalizeSynthesis(value) {
      const record = asRecord(value)
      if (record === null) return null
      const counts = asRecord(record.counts)
      const decision = asRecord(record.decision)
      return {
        requested: slotIds(record.requested),
        succeeded: slotIds(record.succeeded),
        failed: slotIds(record.failed),
        absent: slotIds(record.absent),
        counts: {
          success: counts === null ? null : asNumber(counts.success),
          requested: counts === null ? null : asNumber(counts.requested),
        },
        overlap: asArray(record.overlap)
          .map(function (item) {
            const entry = asRecord(item)
            if (entry === null) return null
            const token = asString(entry.token)
            if (token === null || token === '') return null
            return {
              token: token,
              kind: asString(entry.kind) || 'identifier',
              slots: slotIds(entry.slots),
            }
          })
          .filter(Boolean),
        uniqueBySlot: asArray(record.uniqueBySlot)
          .map(function (item) {
            const entry = asRecord(item)
            if (entry === null) return null
            return { slot: asString(entry.slot) || '?', items: strings(entry.items) }
          })
          .filter(Boolean),
        answerLengths: asArray(record.answerLengths)
          .map(function (item) {
            const entry = asRecord(item)
            if (entry === null) return null
            return { slot: asString(entry.slot) || '?', chars: asNumber(entry.chars) }
          })
          .filter(Boolean),
        // The host normally supplies this note; when it is missing the client
        // falls back to the same caveat, localized like any other UI copy.
        note: asString(record.note) || t('card.synthesisNote'),
        decision:
          decision === null
            ? null
            : {
                verdict: asString(decision.verdict) || '',
                notes: asString(decision.notes) || '',
                at: asString(decision.at),
              },
      }
    }

    function normalizeMeta(value) {
      const record = asRecord(value)
      if (record === null) return null
      const question = asRecord(record.question)
      const privacy = asRecord(record.privacy)
      const routing = asRecord(record.routing)
      const requester = asRecord(record.requester)
      const diagnostics = asRecord(record.diagnostics)
      const slots = asArray(record.slots).map(normalizeSlotMeta).filter(Boolean)
      return {
        version: asNumber(record.version),
        kind: record.kind === 'council' ? 'council' : 'single',
        consultationId: asString(record.consultationId),
        groupId: asString(record.groupId),
        createdAt: asString(record.createdAt),
        durationMs: asNumber(record.durationMs),
        status: asString(record.status) || 'UNKNOWN',
        mode: asString(record.mode),
        reason: asString(record.reason),
        requestedOutput: asString(record.requestedOutput),
        requester:
          requester === null
            ? null
            : {
                agentId: asString(requester.agentId),
                sessionId: asString(requester.sessionId),
                tool: asString(requester.tool),
              },
        routing:
          routing === null
            ? null
            : {
                requestedSlot: asString(routing.requestedSlot),
                autoRouted: routing.autoRouted === true,
                policy: asString(routing.policy),
              },
        privacy:
          privacy === null
            ? null
            : {
                redactions: asNumber(privacy.redactions),
                appliedRules: strings(privacy.appliedRules),
                externalBytes: asNumber(privacy.externalBytes),
                truncated: privacy.truncated === true,
              },
        question:
          question === null
            ? null
            : {
                normalized: asString(question.normalized),
                context: asString(question.context),
                evidence: asString(question.evidence),
                hash: asString(question.hash),
              },
        slots: slots,
        synthesis: normalizeSynthesis(record.synthesis),
        diagnostics:
          diagnostics === null
            ? null
            : { configRevision: asString(diagnostics.configRevision), notes: strings(diagnostics.notes) },
      }
    }

    // Text projection of `block.content` (used by every fallback path).
    function contentText(block) {
      if (!isRecord(block)) return ''
      const parts = []
      for (const item of asArray(block.content)) {
        if (typeof item === 'string') {
          parts.push(item)
          continue
        }
        const record = asRecord(item)
        if (record === null) continue
        const text = asString(record.text)
        if (text !== null && text !== '') parts.push(text)
      }
      if (parts.length === 0) {
        const raw = asString(block.content)
        if (raw !== null) return raw
      }
      return parts.join('\n\n')
    }

    // ------------------------------------------------------------------
    // Clipboard
    // ------------------------------------------------------------------

    function copyText(text) {
      try {
        const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard
        if (clipboard !== null && clipboard !== undefined && typeof clipboard.writeText === 'function') {
          const pending = clipboard.writeText(String(text))
          if (pending !== null && pending !== undefined && typeof pending.catch === 'function') {
            pending.catch(function () {})
          }
        }
      } catch (error) {
        /* silent degradation: copying is a convenience, never a requirement */
      }
    }

    // ------------------------------------------------------------------
    // Small presentation primitives
    // ------------------------------------------------------------------

    function Badge(props) {
      return h(
        'span',
        { className: 'ec-badge', 'data-tone': props.tone || 'muted', title: props.title || undefined },
        props.children,
      )
    }

    function Dot(props) {
      return h('span', { className: 'ec-dot', 'data-tone': props.tone || 'muted', 'aria-hidden': 'true' })
    }

    function Label(props) {
      return h('div', { className: 'ec-label' }, props.children)
    }

    function KV(props) {
      const rows = asArray(props.rows).filter(function (row) {
        return Array.isArray(row) && row.length >= 2 && row[1] !== null && row[1] !== undefined && row[1] !== ''
      })
      if (rows.length === 0) return null
      const children = []
      rows.forEach(function (row, index) {
        children.push(h('dt', { key: 'k' + index }, String(row[0])))
        children.push(h('dd', { key: 'v' + index }, row[1]))
      })
      return h('dl', { className: 'ec-kv' }, children)
    }

    function Pre(props) {
      const text = typeof props.text === 'string' ? props.text : ''
      if (text === '') return null
      return h('pre', { className: 'ec-pre', 'data-tall': props.tall === true ? 'true' : 'false' }, text)
    }

    function CopyButton(props) {
      const [done, setDone] = useState(false)
      const timer = useRef(null)
      useEffect(function () {
        return function cleanup() {
          if (timer.current !== null) clearTimeout(timer.current)
        }
      }, [])
      return h(
        'button',
        {
          type: 'button',
          className: 'ec-btn',
          title: props.title || t('common.copyToClipboard'),
          onClick: function onClick(event) {
            if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') {
              event.stopPropagation()
            }
            const value = typeof props.text === 'function' ? props.text() : props.text
            copyText(value === null || value === undefined ? '' : value)
            setDone(true)
            if (timer.current !== null) clearTimeout(timer.current)
            timer.current = setTimeout(function () {
              setDone(false)
            }, 1400)
          },
        },
        done ? t('common.copied') : props.label || t('common.copy'),
      )
    }

    function Section(props) {
      const head = []
      if (props.title) {
        head.push(h(Label, { key: 'label' }, props.title))
        if (props.action) head.push(h('div', { key: 'action', className: 'ec-actions' }, props.action))
      }
      return h(
        'div',
        { className: 'ec-section' },
        head.length > 0 ? h('div', { className: 'ec-section-head' }, head) : null,
        props.children,
      )
    }

    // Bridges the host-provided `useDisclosure` hook; falls back to local state
    // when the host hook is missing or has an unexpected shape. Both branches
    // call a fixed hook sequence, so hook order is stable.
    function DisclosureBridge(props) {
      const local = useState(false)
      const host = typeof props.useDisclosure === 'function' ? props.useDisclosure() : null
      const hostExpanded = host !== null && host !== undefined && typeof host.expanded === 'boolean' ? host.expanded : null
      const expanded = hostExpanded === null ? local[0] : hostExpanded
      const toggle =
        host !== null && host !== undefined && typeof host.toggle === 'function'
          ? host.toggle
          : function toggleLocal() {
              local[1](function (value) {
                return !value
              })
            }
      return props.render(expanded, toggle)
    }

    function LocalBridge(props) {
      const local = useState(false)
      return props.render(local[0], function toggleLocal() {
        local[1](function (value) {
          return !value
        })
      })
    }

    function Expandable(props) {
      if (typeof props.useDisclosure === 'function') {
        return h(DisclosureBridge, { useDisclosure: props.useDisclosure, render: props.render })
      }
      // A host card always passes `useDisclosure`. When the prop is missing
      // entirely this tree is rendered outside the transcript (static preview,
      // test harness), so the full body is shown instead of an always-collapsed
      // shell. An explicitly null/undefined prop still means "the host has no
      // hook" and keeps the local collapsed state.
      if (props.defaultExpanded === true) {
        return props.render(true, function toggleNoop() {})
      }
      return h(LocalBridge, { useDisclosure: props.useDisclosure, render: props.render })
    }

    // True when the caller supplied no `useDisclosure` prop at all, which
    // means this tree is not being rendered by the host transcript.
    function withoutDisclosureProp(props) {
      return !Object.prototype.hasOwnProperty.call(props, 'useDisclosure')
    }

    // ------------------------------------------------------------------
    // Tool card: shared pieces
    // ------------------------------------------------------------------

    // The category code is stable and localized; the host message is free text
    // and is kept verbatim as secondary diagnostic detail, never dropped.
    function errorDetailRows(error) {
      const rows = []
      if (error.httpStatus !== null) rows.push([t('card.errorHttpStatus'), String(error.httpStatus)])
      if (error.providerCode) rows.push([t('card.errorProviderCode'), error.providerCode])
      if (error.requestId) rows.push([t('card.requestId'), error.requestId])
      if (error.retryable !== null) {
        rows.push([t('card.errorRetryable'), error.retryable ? t('common.yes') : t('common.no')])
      }
      return rows
    }

    function ErrorBox(props) {
      const error = props.error
      if (error === null) return null
      const rows = errorDetailRows(error)
      if (rows.length === 0 && !error.category && !error.message) return null
      return h(
        'div',
        { className: 'ec-errbox' },
        h(
          'div',
          null,
          h('strong', null, errorCategoryText(error.category)),
          error.message ? h('div', { className: 'ec-note', style: { marginTop: '2px' } }, error.message) : null,
        ),
        rows.length > 0 ? h(KV, { rows: rows }) : null,
      )
    }

    function FailureNote(props) {
      if (props.failed !== true) return null
      const text = typeof props.text === 'string' ? props.text : ''
      return h(
        'div',
        { className: 'ec-errbox' },
        h('div', null, h('strong', null, t('card.toolCallFailed')), ' — ', t('card.toolCallFailedDetail')),
        text !== '' ? h(Pre, { text: text }) : null,
      )
    }

    function RequestSection(props) {
      const sent = props.requestSent
      if (sent === null) return null
      const parts = []
      if (sent.system) {
        parts.push(h(Label, { key: 'sys-label' }, t('card.requestSystem')))
        parts.push(h(Pre, { key: 'sys', text: sent.system }))
      }
      parts.push(h(Label, { key: 'user-label' }, t('card.requestUser')))
      parts.push(h(Pre, { key: 'user', text: sent.user || t('common.empty') }))
      parts.push(
        h(KV, {
          key: 'meta',
          rows: [
            [t('card.requestHash'), sent.hash ? sent.hash.slice(0, 16) : null],
            [t('card.sentBytes'), formatBytes(sent.bytes)],
          ],
        }),
      )
      return h(
        Section,
        {
          title: t('card.requestTitle'),
          action: h(CopyButton, {
            text: function requestText() {
              return (sent.system ? '[system]\n' + sent.system + '\n\n' : '') + '[user]\n' + (sent.user || '')
            },
            label: t('card.copyRequest'),
          }),
        },
        parts,
      )
    }

    function RedactionSection(props) {
      const diff = props.redactionDiff
      const privacy = props.privacy
      const rows = []
      if (diff !== null) {
        rows.push([t('card.originalBytes'), formatBytes(diff.originalBytes)])
        rows.push([t('card.sentBytes'), formatBytes(diff.sentBytes)])
        rows.push([t('card.rulesApplied'), diff.rules.length > 0 ? diff.rules.join(', ') : t('common.none')])
      }
      if (privacy !== null) {
        rows.push([
          t('card.redactions'),
          privacy.redactions === null ? t('common.unknown') : String(privacy.redactions),
        ])
        rows.push([t('card.externalBytes'), formatBytes(privacy.externalBytes)])
        rows.push([t('card.truncated'), privacy.truncated ? t('common.yes') : t('common.no')])
        rows.push([
          t('card.appliedRules'),
          privacy.appliedRules.length > 0 ? privacy.appliedRules.join(', ') : t('common.none'),
        ])
      }
      if (rows.length === 0) return null
      return h(Section, { title: t('card.redactionTitle') }, h(KV, { rows: rows }))
    }

    // `extraNotes` carries host-authored text that must stay reachable but is
    // not UI copy (e.g. the verbatim synthesis caveat): it is shown as a
    // diagnostic instead of being translated or dropped.
    function DiagnosticsSection(props) {
      const diagnostics = props.diagnostics
      const extra = strings(props.extraNotes)
      if (diagnostics === null && extra.length === 0) return null
      const rows = []
      if (diagnostics !== null && diagnostics.configRevision) {
        rows.push([t('card.configRevision'), diagnostics.configRevision])
      }
      const notes = diagnostics === null ? extra : extra.concat(diagnostics.notes)
      if (rows.length === 0 && notes.length === 0) return null
      return h(
        Section,
        { title: t('card.diagnosticsTitle') },
        h(KV, { rows: rows }),
        notes.length > 0
          ? h(
              'div',
              { className: 'ec-section' },
              // Host notes are verbatim diagnostics: a neutral localized label
              // introduces them, the text itself is never rewritten.
              h('div', { className: 'ec-note' }, t('card.diagnosticsNotes')),
              h(
                'ul',
                { className: 'ec-note', style: { margin: 0, paddingLeft: '18px' } },
                notes.map(function (note, index) {
                  return h('li', { key: index }, note)
                }),
              ),
            )
          : null,
      )
    }

    function usageLine(usage) {
      if (usage === null) return t('usage.unknown')
      const allNull =
        usage.inputTokens === null &&
        usage.outputTokens === null &&
        usage.totalTokens === null &&
        usage.cacheReadTokens === null &&
        usage.reasoningTokens === null
      if (allNull) return t('usage.unknown')
      const parts = [
        t('usage.input', { value: formatTokens(usage.inputTokens) }),
        t('usage.output', { value: formatTokens(usage.outputTokens) }),
      ]
      if (usage.totalTokens !== null) parts.push(t('usage.total', { value: formatTokens(usage.totalTokens) }))
      if (usage.cacheReadTokens !== null) {
        parts.push(t('usage.cache', { value: formatTokens(usage.cacheReadTokens) }))
      }
      if (usage.reasoningTokens !== null) {
        parts.push(t('usage.reasoning', { value: formatTokens(usage.reasoningTokens) }))
      }
      return parts.join(' · ')
    }

    function FullJson(props) {
      const [open, setOpen] = useState(false)
      const text = useMemo(
        function () {
          try {
            return JSON.stringify(props.value, null, 2)
          } catch (error) {
            return '{"error":"metadata is not serializable"}'
          }
        },
        [props.value],
      )
      return h(
        Section,
        {
          title: t('card.rawJsonTitle'),
          action: h(
            React.Fragment,
            null,
            h(
              'button',
              {
                type: 'button',
                className: 'ec-btn',
                onClick: function onClick(event) {
                  if (event !== null && typeof event.stopPropagation === 'function') event.stopPropagation()
                  setOpen(function (value) {
                    return !value
                  })
                },
              },
              open ? t('common.hide') : t('common.show'),
            ),
            h(CopyButton, { text: text, label: t('common.copyJson') }),
          ),
        },
        open ? h(Pre, { text: text, tall: true }) : null,
      )
    }

    // ------------------------------------------------------------------
    // Tool card: pending (preparing / start)
    // ------------------------------------------------------------------

    function pendingSummary(block) {
      const args = asRecord(block) === null ? null : asRecord(block.args)
      if (args !== null) {
        const question = asString(args.question)
        if (question !== null && question.trim() !== '') return question.trim().slice(0, 160)
        const consultationId = asString(args.consultation_id)
        if (consultationId !== null && consultationId !== '') return consultationId
      }
      const raw = asRecord(block) === null ? null : asString(block.argsRaw)
      if (raw !== null && raw.trim() !== '') return raw.trim().slice(0, 160)
      return null
    }

    function PendingRow(props) {
      const title = toolTitle(props.toolName)
      const summary = pendingSummary(props.block)
      const label = props.phase === 'preparing' ? t('card.pendingPreparing') : t('card.pendingConsulting')
      const raw = asRecord(props.block) === null ? null : asString(props.block.argsRaw)
      return h(
        Expandable,
        {
          useDisclosure: props.useDisclosure,
          defaultExpanded: props.defaultExpanded === true,
          render: function render(expanded, toggle) {
            return h(
              'div',
              { className: 'ec-root', 'data-kind': 'pending' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ec-head',
                  'aria-expanded': expanded ? 'true' : 'false',
                  onClick: function onClick() {
                    toggle()
                  },
                },
                h('span', { className: 'ec-chev', 'data-open': expanded ? 'true' : 'false', 'aria-hidden': 'true' }, '▶'),
                h('span', { className: 'ec-title' }, title),
                h('span', { className: 'ec-pending', style: { flex: '1 1 auto', minWidth: 0 } },
                  h('span', { className: 'ec-pulse', 'aria-hidden': 'true' }),
                  h(
                    'span',
                    {
                      style: {
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    },
                    summary === null ? label : t('card.pendingWithSummary', { label: label, summary: summary }),
                  ),
                ),
              ),
              expanded
                ? h(
                    'div',
                    { className: 'ec-body' },
                    h('div', { className: 'ec-note' }, t('card.pendingNote')),
                    raw !== null && raw !== '' ? h(Pre, { text: raw }) : null,
                  )
                : null,
            )
          },
        },
      )
    }

    // ------------------------------------------------------------------
    // Tool card: single consultation (consult_expert / followup_expert /
    // verify_consultation share the shape)
    // ------------------------------------------------------------------

    function singleAnswerText(slot) {
      return slot === null || slot.answer === null ? '' : slot.answer
    }

    function singleTitleLine(title, slotName, displayName) {
      if (slotName === null || slotName === undefined || slotName === '') return title
      if (displayName === null || displayName === undefined || displayName === '') {
        return t('card.titleSlot', { title: title, slot: slotName })
      }
      return t('card.titleSlotName', { title: title, slot: slotName, name: displayName })
    }

    function copySingleReport(meta) {
      const slot = meta.slots.length > 0 ? meta.slots[0] : null
      const lines = []
      lines.push(t('report.singleHeader', { id: meta.consultationId || t('common.unknownId') }))
      lines.push(t('report.statusLine', { status: meta.status, duration: formatDuration(meta.durationMs) }))
      if (slot !== null) {
        lines.push(
          t('report.slotLine', {
            slot: slot.slot,
            name: slot.displayName,
            model: slot.modelId,
            status: slot.status,
            duration: formatDuration(slot.durationMs),
          }),
        )
        lines.push(
          t('report.protocolLine', {
            protocol: protocolLabel(slot.protocol),
            host: slot.endpointHost || t('common.unknown'),
          }),
        )
      }
      lines.push('')
      lines.push(t('report.answerHeading'))
      lines.push(singleAnswerText(slot))
      return lines.join('\n')
    }

    function SingleCard(props) {
      const meta = props.meta
      const slot = meta.slots.length > 0 ? meta.slots[0] : null
      const requestedSlot = meta.routing === null ? null : meta.routing.requestedSlot
      const slotName = slot === null ? requestedSlot : slot.slot
      const displayName = slot === null ? '' : slot.displayName
      const tone = toneOfStatus(slot === null ? meta.status : slot.status)
      const statusText = slot === null ? meta.status : slot.status
      const titleText = props.title

      return h(
        Expandable,
        {
          useDisclosure: props.useDisclosure,
          defaultExpanded: props.defaultExpanded === true,
          render: function render(expanded, toggle) {
            return h(
              'div',
              { className: 'ec-root', 'data-kind': 'single' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ec-head',
                  'aria-expanded': expanded ? 'true' : 'false',
                  onClick: function onClick() {
                    toggle()
                  },
                },
                h('span', { className: 'ec-chev', 'data-open': expanded ? 'true' : 'false', 'aria-hidden': 'true' }, '▶'),
                h(
                  'span',
                  { className: 'ec-title' },
                  singleTitleLine(titleText, slotName, displayName),
                ),
                h(Badge, { tone: tone }, statusText),
                props.failed === true ? h(Badge, { tone: 'error' }, 'FAILED') : null,
                h(
                  'span',
                  { className: 'ec-sub' },
                  [
                    formatDuration(slot === null ? meta.durationMs : slot.durationMs),
                    slot === null ? null : protocolLabel(slot.protocol),
                    slot === null ? null : slot.providerLabel || slot.endpointHost || null,
                    slot === null ? null : slot.modelId || null,
                    formatCost(slot === null ? null : slot.cost),
                    slot === null ? null : usageLine(slot.usage),
                  ]
                    .filter(function (part) {
                      return part !== null && part !== undefined && part !== ''
                    })
                    .join(' · '),
                ),
              ),
              expanded
                ? h(
                    'div',
                    { className: 'ec-body' },
                    h(
                      'div',
                      { className: 'ec-actions' },
                      h(CopyButton, {
                        text: function answerText() {
                          return singleAnswerText(slot)
                        },
                        label: t('card.copyAnswer'),
                      }),
                      h(CopyButton, {
                        text: function reportText() {
                          return copySingleReport(meta)
                        },
                        label: t('card.copyReport'),
                      }),
                      typeof props.inspect === 'function'
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'ec-btn',
                              onClick: function onClick(event) {
                                if (event !== null && typeof event.stopPropagation === 'function') {
                                  event.stopPropagation()
                                }
                                try {
                                  props.inspect()
                                } catch (error) {
                                  /* inspect is optional */
                                }
                              },
                            },
                            t('card.inspect'),
                          )
                        : null,
                    ),
                    h(
                      Section,
                      { title: t('card.summaryTitle') },
                      h(KV, {
                        rows: [
                          [t('card.consultationId'), meta.consultationId],
                          [t('card.status'), meta.status],
                          [t('card.mode'), meta.mode],
                          [t('card.reason'), meta.reason],
                          [t('card.requestedOutput'), meta.requestedOutput],
                          [t('card.duration'), formatDuration(meta.durationMs)],
                          [t('card.requestedSlot'), requestedSlot],
                          [
                            t('card.autoRouted'),
                            meta.routing === null ? null : meta.routing.autoRouted ? t('common.yes') : t('common.no'),
                          ],
                          [t('card.routingPolicy'), meta.routing === null ? null : meta.routing.policy],
                          [t('card.finishReason'), slot === null ? null : slot.finishReason],
                          [t('card.attempts'), slot === null || slot.attempts === null ? null : String(slot.attempts)],
                          [t('card.requestId'), slot === null ? null : slot.requestId],
                        ],
                      }),
                    ),
                    meta.question !== null && meta.question.normalized
                      ? h(
                          Section,
                          {
                            title: t('card.questionTitle'),
                            action: h(CopyButton, { text: meta.question.normalized, label: t('card.copyQuestion') }),
                          },
                          h(Pre, { text: meta.question.normalized }),
                          meta.question.context ? h(Label, null, t('card.context')) : null,
                          meta.question.context ? h(Pre, { text: meta.question.context }) : null,
                          meta.question.evidence ? h(Label, null, t('card.evidence')) : null,
                          meta.question.evidence ? h(Pre, { text: meta.question.evidence }) : null,
                          h(KV, {
                            rows: [
                              [t('card.questionHash'), meta.question.hash ? meta.question.hash.slice(0, 16) : null],
                            ],
                          }),
                        )
                      : null,
                    h(ErrorBox, { error: slot === null ? null : slot.error }),
                    h(FailureNote, { failed: props.failed === true, text: props.failureText }),
                    slot !== null && slot.answer !== null && slot.answer !== ''
                      ? h(
                          Section,
                          {
                            title: t('card.fullAnswer'),
                            action: h(CopyButton, { text: slot.answer, label: t('common.copy') }),
                          },
                          h(Pre, { text: slot.answer, tall: true }),
                        )
                      : h(
                          Section,
                          { title: t('card.fullAnswer') },
                          h('div', { className: 'ec-note' }, t('card.noAnswerSlot')),
                        ),
                    h(RequestSection, { requestSent: slot === null ? null : slot.requestSent }),
                    h(RedactionSection, {
                      redactionDiff: slot === null ? null : slot.redactionDiff,
                      privacy: meta.privacy,
                    }),
                    h(DiagnosticsSection, { diagnostics: meta.diagnostics }),
                    h(FullJson, { value: meta }),
                  )
                : null,
            )
          },
        },
      )
    }

    // ------------------------------------------------------------------
    // Tool card: council (three parallel panels + mechanical synthesis)
    // ------------------------------------------------------------------

    function councilCostTotal(meta) {
      const counted = meta.slots.filter(function (slot) {
        return slot.status !== 'UNCONFIGURED' && slot.status !== 'DISABLED' && slot.status !== 'NOT_REQUESTED'
      })
      if (counted.length === 0) return t('common.unknown')
      let sum = 0
      let estimated = false
      for (const slot of counted) {
        const amount = asNumber(slot.cost.estimatedUsd)
        if (amount === null) return t('common.unknown')
        sum += amount
        if (slot.cost.source === 'estimated') estimated = true
      }
      return (estimated ? '~$' : '$') + formatUsdAmount(sum)
    }

    function councilSlotList(meta) {
      const requested = meta.synthesis === null ? [] : meta.synthesis.requested
      if (requested.length > 0) return requested
      return meta.slots.map(function (slot) {
        return slot.slot
      })
    }

    function councilReturned(meta) {
      const counts = meta.synthesis === null ? null : meta.synthesis.counts
      if (counts !== null && counts.requested !== null && counts.success !== null) {
        return t('card.returnedCount', { success: counts.success, requested: counts.requested })
      }
      const requested = meta.slots.filter(function (slot) {
        return slot.status !== 'UNCONFIGURED' && slot.status !== 'DISABLED' && slot.status !== 'NOT_REQUESTED'
      })
      const succeeded = requested.filter(function (slot) {
        return slot.status === 'SUCCESS'
      })
      return t('card.returnedCount', { success: succeeded.length, requested: requested.length })
    }

    function copyCouncilReport(meta) {
      const lines = []
      lines.push(t('report.councilHeader', { id: meta.consultationId || t('common.unknownId') }))
      lines.push(
        t('report.councilStatusLine', {
          status: meta.status,
          returned: councilReturned(meta),
          duration: formatDuration(meta.durationMs),
        }),
      )
      lines.push(t('report.totalCost', { cost: councilCostTotal(meta) }))
      if (meta.question !== null && meta.question.normalized) {
        lines.push('')
        lines.push(t('report.questionHeading'))
        lines.push(meta.question.normalized)
      }
      for (const slot of meta.slots) {
        lines.push('')
        lines.push(
          t('report.slotHeading', {
            slot: slot.slot,
            name: slot.displayName || t('common.unnamed'),
            model: slot.modelId || t('common.noModel'),
            status: slot.status,
            duration: formatDuration(slot.durationMs),
          }),
        )
        if (slot.error !== null) {
          lines.push(
            t('report.errorLine', {
              category: slot.error.category || 'UNKNOWN',
              message: slot.error.message || '',
            }),
          )
        }
        lines.push(slot.answer === null || slot.answer === '' ? t('common.noAnswerInline') : slot.answer)
      }
      const synthesis = meta.synthesis
      lines.push('')
      lines.push(t('report.synthesisHeading'))
      if (synthesis === null) {
        lines.push(t('report.noSynthesis'))
      } else {
        // The host note is data: it stays verbatim inside the copied report.
        lines.push(t('report.note', { note: synthesis.note }))
        lines.push(
          t('report.overlap', {
            value:
              synthesis.overlap.length === 0
                ? t('common.none')
                : synthesis.overlap
                    .map(function (item) {
                      return item.token + ' [' + item.slots.join(',') + ']'
                    })
                    .join('; '),
          }),
        )
        lines.push(
          t('report.uniqueBySlot', {
            value:
              synthesis.uniqueBySlot.length === 0
                ? t('common.none')
                : synthesis.uniqueBySlot
                    .map(function (item) {
                      return item.slot + ': ' + (item.items.length === 0 ? '-' : item.items.join(', '))
                    })
                    .join(' | '),
          }),
        )
        lines.push(
          t('report.answerLengths', {
            value:
              synthesis.answerLengths.length === 0
                ? t('common.none')
                : synthesis.answerLengths
                    .map(function (item) {
                      return t('report.answerLength', {
                        slot: item.slot,
                        chars: item.chars === null ? t('common.unknown') : String(item.chars),
                      })
                    })
                    .join(' · '),
          }),
        )
        if (synthesis.decision !== null) {
          lines.push(
            t('report.decision', { verdict: synthesis.decision.verdict, notes: synthesis.decision.notes }),
          )
        }
      }
      return lines.join('\n')
    }

    function CouncilPanel(props) {
      const slot = props.slot
      const [open, setOpen] = useState(false)
      const tone = toneOfStatus(slot.status)
      const hasAnswer = slot.answer !== null && slot.answer !== ''
      return h(
        'section',
        {
          className: 'ec-panel',
          'data-tone': tone === 'ok' || tone === 'muted' ? undefined : tone,
          'data-narrow-hidden': props.narrowHidden ? 'true' : 'false',
          'data-slot': slot.slot,
        },
        h(
          'div',
          { className: 'ec-panel-head' },
          h('span', { className: 'ec-slotbadge' }, slot.slot),
          h('span', { className: 'ec-model', title: slot.modelId }, slot.modelId || t('card.noModelConfigured')),
        ),
        h(
          'div',
          { className: 'ec-panel-head' },
          h(Badge, { tone: tone }, slot.status),
          h('span', { className: 'ec-note' }, formatDuration(slot.durationMs)),
          h('span', { className: 'ec-note' }, formatCost(slot.cost)),
        ),
        h(ErrorBox, { error: slot.error }),
        hasAnswer
          ? h(
              'div',
              { className: 'ec-answer', 'data-collapsed': open ? 'false' : 'true' },
              slot.answer,
            )
          : h('div', { className: 'ec-note' }, t('card.noAnswerRecorded')),
        h(
          'div',
          { className: 'ec-actions' },
          hasAnswer
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'ec-btn',
                  onClick: function onClick(event) {
                    if (event !== null && typeof event.stopPropagation === 'function') event.stopPropagation()
                    setOpen(function (value) {
                      return !value
                    })
                  },
                },
                open ? t('card.collapse') : t('card.expandAnswer'),
              )
            : null,
          hasAnswer ? h(CopyButton, { text: slot.answer, label: t('common.copy') }) : null,
        ),
      )
    }

    function CouncilCard(props) {
      const meta = props.meta
      const slotsList = councilSlotList(meta)
      const [activeTab, setActiveTab] = useState(slotsList.length > 0 ? slotsList[0] : 'L1')
      const synthesis = meta.synthesis
      const tone = toneOfStatus(meta.status)

      const panels = meta.slots.map(function (slot) {
        return h(CouncilPanel, { key: slot.slot, slot: slot, narrowHidden: slot.slot !== activeTab })
      })

      const synthesisRows = []
      if (synthesis !== null) {
        if (synthesis.decision !== null) {
          synthesisRows.push(
            h(
              'div',
              { key: 'decision', className: 'ec-actions' },
              h(
                Badge,
                { tone: toneOfStatus(synthesis.decision.verdict) },
                synthesis.decision.verdict || t('card.decisionFallback'),
              ),
              h('span', { className: 'ec-note' }, synthesis.decision.notes || ''),
            ),
          )
        }
        synthesisRows.push(
          h(
            'div',
            { key: 'note', className: 'ec-warnbox' },
            h('span', { 'aria-hidden': 'true' }, '⚠'),
            // The host note is English prose; the card shows the localized
            // equivalent and keeps the verbatim note in the raw JSON panel.
            h('span', null, t('card.synthesisNote')),
          ),
        )
        synthesisRows.push(
          h(
            Section,
            { key: 'overlap', title: t('card.overlapTitle') },
            synthesis.overlap.length === 0
              ? h('div', { className: 'ec-note' }, t('card.overlapEmpty'))
              : h(
                  'div',
                  { className: 'ec-chips' },
                  synthesis.overlap.slice(0, 60).map(function (item, index) {
                    return h(
                      'span',
                      { key: index, className: 'ec-chip', 'data-kind': item.kind, title: item.slots.join(', ') },
                      item.token,
                      h('span', { style: { opacity: 0.7 } }, ' [' + item.slots.join(',') + ']'),
                    )
                  }),
                ),
          ),
        )
        synthesisRows.push(
          h(
            Section,
            { key: 'unique', title: t('card.uniqueBySlotTitle') },
            synthesis.uniqueBySlot.length === 0
              ? h('div', { className: 'ec-note' }, t('card.uniqueEmpty'))
              : h(
                  'div',
                  { className: 'ec-chips' },
                  synthesis.uniqueBySlot.map(function (item, index) {
                    return h(
                      'span',
                      { key: index, className: 'ec-chip' },
                      item.slot + ': ' + (item.items.length === 0 ? '—' : item.items.join(', ')),
                    )
                  }),
                ),
          ),
        )
        synthesisRows.push(
          h(
            Section,
            { key: 'lengths', title: t('card.answerLengthsTitle') },
            h(KV, {
              rows: synthesis.answerLengths.map(function (item) {
                return [
                  item.slot,
                  item.chars === null
                    ? t('common.unknown')
                    : t('unit.chars', { value: groupDigits(item.chars) }),
                ]
              }),
            }),
          ),
        )
      }

      return h(
        Expandable,
        {
          useDisclosure: props.useDisclosure,
          defaultExpanded: props.defaultExpanded === true,
          render: function render(expanded, toggle) {
            return h(
              'div',
              { className: 'ec-root', 'data-kind': 'council' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ec-head',
                  'aria-expanded': expanded ? 'true' : 'false',
                  onClick: function onClick() {
                    toggle()
                  },
                },
                h('span', { className: 'ec-chev', 'data-open': expanded ? 'true' : 'false', 'aria-hidden': 'true' }, '▶'),
                h(
                  'span',
                  { className: 'ec-title' },
                  t('card.councilTitle', {
                    title: t('tool.consultCouncil'),
                    slots: slotsList.length > 0 ? slotsList.join(' / ') : 'L1 / L2 / L3',
                  }),
                ),
                h(Badge, { tone: tone }, meta.status),
                props.failed === true ? h(Badge, { tone: 'error' }, 'FAILED') : null,
                h(
                  'span',
                  { className: 'ec-sub' },
                  t('card.councilSubLine', {
                    returned: councilReturned(meta),
                    duration: formatDuration(meta.durationMs),
                    cost: councilCostTotal(meta),
                  }),
                ),
              ),
              expanded
                ? h(
                    'div',
                    { className: 'ec-body' },
                    h(
                      'div',
                      { className: 'ec-actions' },
                      h(CopyButton, {
                        text: function reportText() {
                          return copyCouncilReport(meta)
                        },
                        label: t('card.copyComparison'),
                      }),
                      h(CopyButton, {
                        text: function questionText() {
                          return meta.question === null ? '' : meta.question.normalized || ''
                        },
                        label: t('card.copyQuestion'),
                      }),
                      typeof props.inspect === 'function'
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'ec-btn',
                              onClick: function onClick(event) {
                                if (event !== null && typeof event.stopPropagation === 'function') {
                                  event.stopPropagation()
                                }
                                try {
                                  props.inspect()
                                } catch (error) {
                                  /* inspect is optional */
                                }
                              },
                            },
                            t('card.inspect'),
                          )
                        : null,
                    ),
                    meta.question !== null && meta.question.normalized
                      ? h(
                          Section,
                          { title: t('card.questionSnapshotTitle') },
                          h(Pre, { text: meta.question.normalized }),
                        )
                      : null,
                    h(FailureNote, { failed: props.failed === true, text: props.failureText }),
                    h(
                      'div',
                      { className: 'ec-tabs', role: 'tablist' },
                      slotsList.map(function (slotId) {
                        return h(
                          'button',
                          {
                            key: slotId,
                            type: 'button',
                            className: 'ec-tab',
                            'data-active': slotId === activeTab ? 'true' : 'false',
                            onClick: function onClick() {
                              setActiveTab(slotId)
                            },
                          },
                          slotId,
                        )
                      }),
                    ),
                    h('div', { className: 'ec-council' }, panels),
                    h(
                      'div',
                      { className: 'ec-synth' },
                      h(
                        'div',
                        { className: 'ec-section-head' },
                        h(Label, null, t('card.synthesisTitle')),
                        h('span', { className: 'ec-note' }, t('card.synthesisSubtitle')),
                      ),
                      synthesisRows.length > 0
                        ? synthesisRows
                        : h('div', { className: 'ec-note' }, t('card.noSynthesis')),
                    ),
                    h(RedactionSection, { redactionDiff: null, privacy: meta.privacy }),
                    h(DiagnosticsSection, {
                      diagnostics: meta.diagnostics,
                      // The host's own caveat wording is data, not UI copy: the
                      // card shows t('card.synthesisNote') and keeps the
                      // verbatim note here as well, so an auditor can always read
                      // exactly what the host recorded. Collapsed cards render no
                      // body at all, so this is only visible once expanded.
                      extraNotes: meta.synthesis === null ? [] : [meta.synthesis.note],
                    }),
                    h(FullJson, { value: meta }),
                  )
                : null,
            )
          },
        },
      )
    }

    // ------------------------------------------------------------------
    // Tool card: generic fallback when meta is absent or unusable
    // ------------------------------------------------------------------

    function FallbackCard(props) {
      const text = contentText(props.block)
      const isError = props.block !== null && props.block.isError === true
      const tone = isError ? 'error' : 'muted'
      return h(
        Expandable,
        {
          useDisclosure: props.useDisclosure,
          defaultExpanded: props.defaultExpanded === true,
          render: function render(expanded, toggle) {
            return h(
              'div',
              { className: 'ec-root', 'data-kind': 'fallback' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ec-head',
                  'aria-expanded': expanded ? 'true' : 'false',
                  onClick: function onClick() {
                    toggle()
                  },
                },
                h('span', { className: 'ec-chev', 'data-open': expanded ? 'true' : 'false', 'aria-hidden': 'true' }, '▶'),
                h('span', { className: 'ec-title' }, toolTitle(props.toolName)),
                h(Badge, { tone: tone }, isError ? 'FAILED' : 'RESULT'),
                h(
                  'span',
                  { className: 'ec-sub' },
                  text === '' ? t('card.noStructuredMeta') : text.slice(0, 120).replace(/\s+/g, ' '),
                ),
              ),
              expanded
                ? h(
                    'div',
                    { className: 'ec-body' },
                    h(
                      'div',
                      { className: 'ec-note' },
                      t('card.fallbackNote'),
                    ),
                    text === ''
                      ? h('div', { className: 'ec-note' }, t('common.emptyResult'))
                      : h(Pre, { text: text, tall: true }),
                    h(CopyButton, { text: text, label: t('card.copyResultText') }),
                  )
                : null,
            )
          },
        },
      )
    }

    // ------------------------------------------------------------------
    // Tool view components (one per wire tool name)
    // ------------------------------------------------------------------

    function renderResult(props, options) {
      const block = asRecord(props.block)
      const meta = block === null ? null : normalizeMeta(block.meta)
      if (meta === null) {
        return h(FallbackCard, {
          block: block,
          toolName: props.toolName,
          useDisclosure: props.useDisclosure,
          defaultExpanded: withoutDisclosureProp(props),
        })
      }
      const failed = block !== null && block.isError === true
      const failureText = failed ? contentText(block) : ''
      const wantsCouncil = options !== null && options.council === true
      if (meta.kind === 'council' || wantsCouncil) {
        return h(CouncilCard, {
          meta: meta,
          failed: failed,
          failureText: failureText,
          useDisclosure: props.useDisclosure,
          defaultExpanded: withoutDisclosureProp(props),
          inspect: props.inspect,
        })
      }
      return h(SingleCard, {
        meta: meta,
        failed: failed,
        failureText: failureText,
        title: options !== null && options.title ? options.title : t('tool.consultExpert'),
        useDisclosure: props.useDisclosure,
        defaultExpanded: withoutDisclosureProp(props),
        inspect: props.inspect,
      })
    }

    function safeRender(props, render) {
      try {
        return render()
      } catch (error) {
        // A card must never break the conversation transcript.
        return h(FallbackCard, {
          block: asRecord(props.block),
          toolName: props.toolName,
          useDisclosure: props.useDisclosure,
          defaultExpanded: withoutDisclosureProp(props),
        })
      }
    }

    function ConsultExpertView(props) {
      // Every entry component subscribes once; a locale switch re-renders the
      // whole subtree, so child components need no listener of their own.
      useLocaleRevision()
      if (props.phase !== 'result') {
        return h(PendingRow, {
          phase: props.phase,
          toolName: props.toolName,
          block: props.block,
          useDisclosure: props.useDisclosure,
          defaultExpanded: withoutDisclosureProp(props),
        })
      }
      return safeRender(props, function render() {
        return renderResult(props, { title: t('tool.consultExpert'), council: false })
      })
    }

    function ConsultCouncilView(props) {
      useLocaleRevision()
      if (props.phase !== 'result') {
        return h(PendingRow, {
          phase: props.phase,
          toolName: props.toolName,
          block: props.block,
          useDisclosure: props.useDisclosure,
          defaultExpanded: withoutDisclosureProp(props),
        })
      }
      return safeRender(props, function render() {
        return renderResult(props, { title: t('tool.consultCouncil'), council: true })
      })
    }

    function FollowupExpertView(props) {
      useLocaleRevision()
      if (props.phase !== 'result') {
        return h(PendingRow, {
          phase: props.phase,
          toolName: props.toolName,
          block: props.block,
          useDisclosure: props.useDisclosure,
          defaultExpanded: withoutDisclosureProp(props),
        })
      }
      return safeRender(props, function render() {
        return renderResult(props, { title: t('tool.followupExpert'), council: false })
      })
    }

    function VerifyConsultationView(props) {
      useLocaleRevision()
      if (props.phase !== 'result') {
        return h(PendingRow, {
          phase: props.phase,
          toolName: props.toolName,
          block: props.block,
          useDisclosure: props.useDisclosure,
          defaultExpanded: withoutDisclosureProp(props),
        })
      }
      return safeRender(props, function render() {
        const block = asRecord(props.block)
        const meta = block === null ? null : normalizeMeta(block.meta)
        if (meta === null) {
          return h(FallbackCard, {
            block: block,
            toolName: props.toolName,
            useDisclosure: props.useDisclosure,
            defaultExpanded: withoutDisclosureProp(props),
          })
        }
        const decision = meta.synthesis === null ? null : meta.synthesis.decision
        return h(
          'div',
          { className: 'ec-root', 'data-kind': 'verify' },
          h(
            'div',
            { className: 'ec-head', style: { cursor: 'default' } },
            h('span', { className: 'ec-chev', 'aria-hidden': 'true' }, '▶'),
            h(
              'span',
              { className: 'ec-title' },
              decision !== null && decision.verdict
                ? t('card.titleSlot', { title: t('tool.verifyConsultation'), slot: decision.verdict })
                : t('tool.verifyConsultation'),
            ),
            h(
              Badge,
              { tone: toneOfStatus(decision === null ? meta.status : decision.verdict) },
              decision === null ? meta.status : decision.verdict || 'RECORDED',
            ),
            h(
              'span',
              { className: 'ec-sub' },
              [meta.consultationId, formatDuration(meta.durationMs)].filter(Boolean).join(' · '),
            ),
          ),
          h(
            'div',
            { className: 'ec-body' },
            decision !== null
              ? h(
                  Section,
                  {
                    title: t('card.recordedVerdictTitle'),
                    action: h(CopyButton, { text: decision.notes, label: t('card.copyNotes') }),
                  },
                  h(KV, {
                    rows: [
                      [t('card.verdict'), decision.verdict],
                      [t('card.recordedAt'), decision.at],
                    ],
                  }),
                  h(Pre, { text: decision.notes }),
                )
              : h('div', { className: 'ec-note' }, t('card.noVerdictDetails')),
            h(FullJson, { value: meta }),
          ),
        )
      })
    }

    // ------------------------------------------------------------------
    // Settings page: HTTP client
    // ------------------------------------------------------------------

    const API_HEADER = 'x-dsh-expert-council'
    let apiBase = '/expert-council/'

    function readErrorMessage(payload, fallback) {
      const record = asRecord(payload)
      if (record !== null) {
        const error = asRecord(record.error)
        if (error !== null) {
          const message = asString(error.message)
          if (message !== null && message !== '') return message
        }
        const message = asString(record.message)
        if (message !== null && message !== '') return message
      }
      return fallback
    }

    async function apiRequest(path, options) {
      const settings = options === null || options === undefined ? {} : options
      const method = settings.method || 'GET'
      const headers = { Accept: 'application/json' }
      headers[API_HEADER] = '1'
      let body
      if (settings.body !== undefined) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(settings.body)
      }
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      let timer = null
      if (controller !== null && typeof settings.timeoutMs === 'number') {
        timer = setTimeout(function () {
          try {
            controller.abort()
          } catch (error) {
            /* ignore */
          }
        }, settings.timeoutMs)
      }
      let response
      try {
        response = await fetch(apiBase + path, {
          method: method,
          headers: headers,
          body: body,
          signal: controller === null ? undefined : controller.signal,
        })
      } catch (error) {
        if (timer !== null) clearTimeout(timer)
        throw new Error(
          t('settings.networkError', { message: error && error.message ? error.message : String(error) }),
        )
      }
      if (timer !== null) clearTimeout(timer)
      let payload = null
      let text = ''
      try {
        text = await response.text()
      } catch (error) {
        text = ''
      }
      if (text !== '') {
        try {
          payload = JSON.parse(text)
        } catch (error) {
          payload = null
        }
      }
      if (!response.ok) {
        throw new Error(
          t('settings.requestFailed', {
            message: readErrorMessage(
              payload,
              t('settings.httpStatusLine', { status: response.status, statusText: response.statusText }),
            ),
            status: response.status,
          }),
        )
      }
      if (payload === null) throw new Error(t('settings.nonJsonResponse'))
      if (payload.ok === false) {
        const error = asRecord(payload.error)
        throw new Error(
          error !== null && asString(error.message)
            ? asString(error.message)
            : readErrorMessage(payload, t('settings.refused')),
        )
      }
      return payload
    }

    // ------------------------------------------------------------------
    // Settings page: draft model
    // ------------------------------------------------------------------

    function emptyDraft() {
      return {
        enabled: false,
        displayName: '',
        protocol: 'openai_chat_completions',
        providerLabel: '',
        baseUrl: '',
        modelId: '',
        maxOutputTokens: '',
        reasoningEffort: '',
        thinkingBudget: '',
        temperature: '',
        timeoutMs: '',
        retries: '',
        apiVersion: '',
        authScheme: 'x-api-key',
        apiKey: '',
      }
    }

    function draftFromSlot(slot) {
      const draft = emptyDraft()
      if (!isRecord(slot)) return draft
      draft.enabled = slot.enabled === true
      draft.displayName = asString(slot.displayName) || ''
      draft.protocol = slot.protocol === 'anthropic_messages' ? 'anthropic_messages' : 'openai_chat_completions'
      draft.providerLabel = asString(slot.providerLabel) || ''
      draft.baseUrl = asString(slot.baseUrl) || ''
      draft.modelId = asString(slot.modelId) || ''
      draft.maxOutputTokens = asNumber(slot.maxOutputTokens) === null ? '' : String(slot.maxOutputTokens)
      draft.reasoningEffort = asString(slot.reasoningEffort) || ''
      draft.thinkingBudget = asNumber(slot.thinkingBudget) === null ? '' : String(slot.thinkingBudget)
      draft.temperature = asNumber(slot.temperature) === null ? '' : String(slot.temperature)
      draft.timeoutMs = asNumber(slot.timeoutMs) === null ? '' : String(slot.timeoutMs)
      draft.retries = asNumber(slot.retries) === null ? '' : String(slot.retries)
      draft.apiVersion = asString(slot.apiVersion) || ''
      draft.authScheme = slot.authScheme === 'bearer' ? 'bearer' : 'x-api-key'
      return draft
    }

    function draftSignature(draft) {
      return JSON.stringify([
        draft.enabled,
        draft.displayName,
        draft.protocol,
        draft.providerLabel,
        draft.baseUrl,
        draft.modelId,
        draft.maxOutputTokens,
        draft.temperature,
        draft.timeoutMs,
        draft.retries,
        draft.apiVersion,
        draft.authScheme,
      ])
    }

    function parseIntegerField(value, label, minimum) {
      const text = String(value === null || value === undefined ? '' : value).trim()
      if (text === '') return { ok: false, message: t('settings.fieldRequired', { label: label }) }
      if (!/^-?\d+$/.test(text)) return { ok: false, message: t('settings.fieldInteger', { label: label }) }
      const number = Number(text)
      if (!Number.isFinite(number)) return { ok: false, message: t('settings.fieldInteger', { label: label }) }
      if (typeof minimum === 'number' && number < minimum) {
        return { ok: false, message: t('settings.fieldMinimum', { label: label, minimum: minimum }) }
      }
      return { ok: true, value: number }
    }

    function parseTemperature(value) {
      const text = String(value === null || value === undefined ? '' : value).trim()
      if (text === '') return { ok: true, value: null }
      const number = Number(text)
      if (!Number.isFinite(number) || number < 0) {
        return { ok: false, message: t('settings.temperatureInvalid') }
      }
      return { ok: true, value: number }
    }

    function buildSlotPatch(draft) {
      const maxOutputTokens = parseIntegerField(draft.maxOutputTokens, t('settings.maxOutputTokens'), 1)
      if (!maxOutputTokens.ok) return { ok: false, message: maxOutputTokens.message }
      const timeoutMs = parseIntegerField(draft.timeoutMs, t('settings.timeout'), 1000)
      if (!timeoutMs.ok) return { ok: false, message: timeoutMs.message }
      const retries = parseIntegerField(draft.retries, t('settings.retries'), 0)
      if (!retries.ok) return { ok: false, message: retries.message }
      const temperature = parseTemperature(draft.temperature)
      if (!temperature.ok) return { ok: false, message: temperature.message }
      const patch = {
        enabled: draft.enabled === true,
        displayName: String(draft.displayName || '').trim(),
        protocol: draft.protocol === 'anthropic_messages' ? 'anthropic_messages' : 'openai_chat_completions',
        providerLabel: String(draft.providerLabel || '').trim(),
        baseUrl: String(draft.baseUrl || '').trim(),
        modelId: String(draft.modelId || '').trim(),
        maxOutputTokens: maxOutputTokens.value,
        timeoutMs: timeoutMs.value,
        retries: retries.value,
        temperature: temperature.value,
      }
      // An empty effort means "do not send the parameter at all", which is
      // different from any concrete level: the provider keeps its own default.
      const effort = String(draft.reasoningEffort || '').trim()
      if (effort !== '') patch.reasoningEffort = effort
      // An explicit Anthropic thinking budget wins over the effort-derived one.
      const budgetText = String(draft.thinkingBudget || '').trim()
      if (budgetText !== '') {
        const budget = Number(budgetText)
        if (!Number.isFinite(budget) || budget <= 0 || !Number.isInteger(budget)) {
          return { ok: false, message: t('settings.thinkingBudgetInvalid') }
        }
        patch.thinkingBudget = budget
      }
      if (patch.protocol === 'anthropic_messages') {
        patch.apiVersion = String(draft.apiVersion || '').trim()
        patch.authScheme = draft.authScheme === 'bearer' ? 'bearer' : 'x-api-key'
      }
      return { ok: true, patch: patch }
    }

    function credentialStateOf(state, slot) {
      const credentials = state === null ? null : asRecord(state.credentials)
      const ref = slot === null ? null : asString(slot.credentialRef)
      if (credentials !== null && ref !== null) {
        const record = asRecord(credentials[ref])
        if (record !== null) {
          return {
            configured: record.configured === true,
            source: asString(record.source),
          }
        }
      }
      if (slot !== null && slot.credentialConfigured === true) {
        return { configured: true, source: null }
      }
      return { configured: false, source: null }
    }

    // ------------------------------------------------------------------
    // Settings page: components
    // ------------------------------------------------------------------

    function SettingsField(props) {
      return h(
        'div',
        { className: 'ecs-row' },
        h(
          'div',
          { className: 'ecs-row-main' },
          h('div', { className: 'ecs-row-title' }, props.title),
          props.hint ? h('div', { className: 'ecs-row-hint' }, props.hint) : null,
        ),
        h('div', { className: 'ecs-control' }, props.children),
      )
    }

    function SlotEditor(props) {
      const slot = props.slot
      const draft = props.draft
      const busy = props.busy
      const note = props.note
      const testResult = props.testResult
      const credential = credentialStateOf(props.state, slot)
      const isAnthropic = draft.protocol === 'anthropic_messages'
      const dirty = props.baseline === null ? true : draftSignature(draft) !== draftSignature(props.baseline)

      function field(name) {
        return {
          value: draft[name] === undefined ? '' : draft[name],
          onChange: function onChange(event) {
            props.onChange(name, event.target.value)
          },
        }
      }

      const header = h(
        'div',
        { className: 'ecs-card-head' },
        h('span', { className: 'ecs-slot' }, slot.slot),
        h(
          'span',
          { className: 'ecs-card-title' },
          draft.displayName || slot.displayName || t('settings.slotName', { slot: slot.slot }),
        ),
        h(
          Badge,
          { tone: slot.configured === true ? 'ok' : 'muted' },
          slot.configured === true ? t('settings.configured') : t('settings.incomplete'),
        ),
        h(
          Badge,
          { tone: draft.enabled ? 'ok' : 'muted' },
          draft.enabled ? t('settings.enabled') : t('settings.disabled'),
        ),
        dirty ? h(Badge, { tone: 'warn' }, t('settings.unsavedChanges')) : null,
      )

      return h(
        'div',
        { className: 'ecs-card', 'data-slot': slot.slot },
        header,
        h(
          SettingsField,
          {
            title: t('settings.enabledLabel'),
            hint: t('settings.enabledHint'),
          },
          h('input', {
            type: 'checkbox',
            className: 'ecs-check',
            checked: draft.enabled === true,
            disabled: busy !== null,
            onChange: function onChange(event) {
              props.onChange('enabled', event.target.checked)
            },
          }),
        ),
        h(
          SettingsField,
          { title: t('settings.displayName'), hint: t('settings.displayNameHint') },
          h(
            'input',
            Object.assign(
              {
                type: 'text',
                className: 'ecs-input',
                'data-width': 'mid',
                placeholder: t('settings.displayNamePlaceholder'),
                disabled: busy !== null,
              },
              field('displayName'),
            ),
          ),
        ),
        h(
          SettingsField,
          {
            title: t('settings.apiFormat'),
            hint: t('settings.apiFormatHint'),
          },
          h(
            'select',
            Object.assign({ className: 'ecs-select', disabled: busy !== null }, field('protocol')),
            (Array.isArray(props.protocols) && props.protocols.length > 0
              ? props.protocols
              : ['openai_chat_completions', 'anthropic_messages']
            ).map(function (protocol) {
              return h('option', { key: protocol, value: protocol }, protocol)
            }),
          ),
        ),
        h(
          SettingsField,
          { title: t('settings.providerName'), hint: t('settings.providerNameHint') },
          h(
            'input',
            Object.assign(
              {
                type: 'text',
                className: 'ecs-input',
                'data-width': 'mid',
                placeholder: t('settings.providerNamePlaceholder'),
                disabled: busy !== null,
              },
              field('providerLabel'),
            ),
          ),
        ),
        h(
          SettingsField,
          { title: t('settings.baseUrl'), hint: t('settings.baseUrlHint') },
          h('input', Object.assign({ type: 'url', className: 'ecs-input', 'data-width': 'wide', placeholder: 'https://api.example.com/v1', spellCheck: false, disabled: busy !== null }, field('baseUrl'))),
        ),
        h(
          SettingsField,
          { title: t('settings.modelId'), hint: t('settings.modelIdHint') },
          h('input', Object.assign({ type: 'text', className: 'ecs-input', 'data-width': 'wide', placeholder: 'model-id', spellCheck: false, disabled: busy !== null }, field('modelId'))),
        ),
        h(
          SettingsField,
          {
            title: t('settings.credential'),
            hint: t('settings.credentialHint', { reference: slot.credentialRef || t('common.unknown') }),
          },
          h(
            Badge,
            { tone: credential.configured ? 'ok' : 'error' },
            credential.configured ? t('settings.configured') : t('settings.missing'),
          ),
          credential.source
            ? h(Badge, { tone: 'muted' }, t('settings.credentialSource', { source: credential.source }))
            : null,
        ),
        h(
          SettingsField,
          { title: t('settings.apiKey'), hint: t('settings.apiKeyHint') },
          h('input', {
            type: 'password',
            className: 'ecs-input',
            'data-width': 'mid',
            placeholder: credential.configured
              ? t('settings.replaceKeyPlaceholder')
              : t('settings.pasteKeyPlaceholder'),
            autoComplete: 'off',
            spellCheck: false,
            value: draft.apiKey,
            disabled: busy !== null,
            onChange: function onChange(event) {
              props.onChange('apiKey', event.target.value)
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'ecs-btn',
              disabled: busy !== null || String(draft.apiKey || '').trim() === '',
              onClick: function onClick() {
                props.onSaveKey()
              },
            },
            busy === 'key' ? t('settings.saving') : t('settings.saveKey'),
          ),
          credential.configured
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'ecs-btn',
                  disabled: busy !== null,
                  onClick: function onClick() {
                    if (typeof props.onRemoveKey === 'function') props.onRemoveKey()
                  },
                },
                busy === 'remove-key' ? t('settings.removing') : t('settings.removeKey'),
              )
            : null,
        ),
        h(
          SettingsField,
          { title: t('settings.maxOutputTokens'), hint: t('settings.maxOutputTokensHint') },
          h('input', Object.assign({ type: 'number', min: 1, className: 'ecs-input', 'data-width': 'narrow', disabled: busy !== null }, field('maxOutputTokens'))),
        ),
        h(
          SettingsField,
          { title: t('settings.temperature'), hint: t('settings.temperatureHint') },
          h(
            'input',
            Object.assign(
              {
                type: 'text',
                inputMode: 'decimal',
                className: 'ecs-input',
                'data-width': 'narrow',
                placeholder: t('settings.temperaturePlaceholder'),
                disabled: busy !== null,
              },
              field('temperature'),
            ),
          ),
        ),
        h(
          SettingsField,
          { title: t('settings.reasoningEffort'), hint: t('settings.reasoningEffortHint') },
          h(
            'select',
            Object.assign({ className: 'ecs-select', disabled: busy !== null }, field('reasoningEffort')),
            h('option', { value: '' }, t('settings.reasoningEffortOff')),
            h('option', { value: 'minimal' }, 'minimal'),
            h('option', { value: 'low' }, 'low'),
            h('option', { value: 'medium' }, 'medium'),
            h('option', { value: 'high' }, 'high'),
            h('option', { value: 'xhigh' }, 'xhigh'),
            h('option', { value: 'max' }, t('settings.reasoningEffortMax')),
          ),
        ),
        isAnthropic
          ? h(
              SettingsField,
              { title: t('settings.thinkingBudget'), hint: t('settings.thinkingBudgetHint') },
              h('input', Object.assign({ type: 'number', min: 0, step: 1024, className: 'ecs-input', 'data-width': 'narrow', placeholder: t('settings.reasoningEffortOff'), disabled: busy !== null }, field('thinkingBudget'))),
            )
          : null,
        h(
          SettingsField,
          { title: t('settings.timeout'), hint: t('settings.timeoutHint') },
          h('input', Object.assign({ type: 'number', min: 1000, step: 1000, className: 'ecs-input', 'data-width': 'narrow', disabled: busy !== null }, field('timeoutMs'))),
        ),
        h(
          SettingsField,
          { title: t('settings.retries'), hint: t('settings.retriesHint') },
          h('input', Object.assign({ type: 'number', min: 0, className: 'ecs-input', 'data-width': 'narrow', disabled: busy !== null }, field('retries'))),
        ),
        isAnthropic
          ? h(
              SettingsField,
              { title: t('settings.anthropicVersion'), hint: t('settings.anthropicVersionHint') },
              h('input', Object.assign({ type: 'text', className: 'ecs-input', 'data-width': 'mid', placeholder: '2023-06-01', spellCheck: false, disabled: busy !== null }, field('apiVersion'))),
            )
          : null,
        isAnthropic
          ? h(
              SettingsField,
              { title: t('settings.authScheme'), hint: t('settings.authSchemeHint') },
              h(
                'select',
                Object.assign({ className: 'ecs-select', disabled: busy !== null }, field('authScheme')),
                h('option', { value: 'x-api-key' }, 'x-api-key'),
                h('option', { value: 'bearer' }, 'bearer'),
              ),
            )
          : null,
        h(
          'div',
          { className: 'ecs-footer' },
          h(
            'button',
            {
              type: 'button',
              className: 'ecs-btn',
              'data-variant': 'primary',
              disabled: busy !== null,
              onClick: function onClick() {
                props.onSave()
              },
            },
            busy === 'save' ? t('settings.saving') : t('settings.save'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'ecs-btn',
              disabled: busy !== null,
              onClick: function onClick() {
                props.onTest()
              },
            },
            busy === 'test' ? t('settings.testing') : t('settings.testConnection'),
          ),
          h('span', { className: 'ecs-hint' }, t('settings.testBillingWarning')),
          note
            ? h('div', { className: 'ecs-note', 'data-kind': note.kind, style: { width: '100%' } }, note.text)
            : null,
          testResult ? h(TestResultView, { result: testResult }) : null,
          slot.warnings && slot.warnings.length > 0
            ? h(
                'div',
                { className: 'ecs-banner', style: { width: '100%' } },
                slot.warnings.map(function (warning, index) {
                  return h('div', { key: index }, warning)
                }),
              )
            : null,
        ),
      )
    }

    function TestResultView(props) {
      const result = asRecord(props.result)
      if (result === null) return null
      const yesNo = function yesNo(flag) {
        return flag === true ? t('test.yes') : t('test.no')
      }
      const rows = [
        [t('test.host'), asString(result.endpointHost) || t('common.unknown')],
        [t('test.protocol'), asString(result.protocol) || t('common.unknown')],
        [t('test.model'), asString(result.modelId) || t('common.unknown')],
        [t('test.authOk'), yesNo(result.authOk)],
        [t('test.nonStreamOk'), yesNo(result.nonStreamOk)],
        [t('test.parseOk'), yesNo(result.parseOk)],
        [t('test.usageAvailable'), yesNo(result.usageAvailable)],
        [t('test.latency'), formatDuration(result.latencyMs)],
        [t('test.billable'), result.billable === true ? t('test.billableYes') : t('common.unknown')],
      ]
      const error = asRecord(result.error)
      return h(
        'div',
        { style: { width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' } },
        h(
          'dl',
          { className: 'ecs-test' },
          rows.reduce(function (acc, row) {
            acc.push(h('dt', { key: 'k-' + row[0] }, row[0]))
            acc.push(h('dd', { key: 'v-' + row[0] }, row[1]))
            return acc
          }, []),
        ),
        error !== null
          ? h(
              'div',
              { className: 'ecs-note', 'data-kind': 'error' },
              (function errorText() {
                const head = errorCategoryText(asString(error.category))
                const message = asString(error.message) || ''
                const text = message === '' ? head : head + ' · ' + message
                const status = asNumber(error.httpStatus)
                return status === null ? text : t('test.errorStatus', { text: text, status: status })
              })(),
            )
          : null,
      )
    }

    function HistoryRow(props) {
      const summary = props.summary
      const [open, setOpen] = useState(false)
      const id = asString(summary.consultationId) || asString(summary.id) || t('common.unknownId')
      const questionRecord = asRecord(summary.question)
      const question =
        (questionRecord === null ? null : asString(questionRecord.normalized)) || asString(summary.question) || ''
      const status = asString(summary.status) || 'UNKNOWN'
      const kind = asString(summary.kind) || ''
      const mode = asString(summary.mode) || ''
      let json = ''
      try {
        json = JSON.stringify(summary, null, 2)
      } catch (error) {
        json = '{"error":"summary is not serializable"}'
      }
      return h(
        'div',
        { className: 'ecs-card', style: { marginBottom: '8px' } },
        h(
          'div',
          { className: 'ecs-card-head' },
          h('span', { className: 'ecs-slot' }, kind === 'council' ? '3×' : '1×'),
          h('span', { className: 'ecs-card-title' }, id),
          h(Badge, { tone: toneOfStatus(status) }, status),
          mode ? h(Badge, { tone: 'muted' }, mode) : null,
          h('span', { className: 'ecs-hint' }, formatDuration(summary.durationMs)),
        ),
        h(
          'div',
          { className: 'ecs-row' },
          h(
            'div',
            { className: 'ecs-row-main' },
            h('div', { className: 'ecs-row-hint' }, question === '' ? t('history.noQuestion') : question),
            asString(summary.createdAt) ? h('div', { className: 'ecs-hint' }, summary.createdAt) : null,
          ),
          h(
            'div',
            { className: 'ecs-control' },
            h(
              'button',
              {
                type: 'button',
                className: 'ecs-btn',
                onClick: function onClick() {
                  setOpen(function (value) {
                    return !value
                  })
                },
              },
              open ? t('common.hide') : t('common.details'),
            ),
            h(CopyButton, { text: json, label: t('common.copyJson') }),
            h(
              'button',
              {
                type: 'button',
                className: 'ecs-btn',
                disabled: props.busy === true,
                onClick: function onClick() {
                  props.onDelete(id)
                },
              },
              props.busy === true ? t('settings.deleting') : t('history.delete'),
            ),
          ),
        ),
        open ? h(Pre, { text: json, tall: true }) : null,
      )
    }

    function HistorySection() {
      const [items, setItems] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState(null)
      const [deleting, setDeleting] = useState(null)
      const alive = useRef(true)

      useEffect(function () {
        alive.current = true
        return function cleanup() {
          alive.current = false
        }
      }, [])

      async function loadHistory() {
        setLoading(true)
        setError(null)
        try {
          const response = await apiRequest('history?limit=20', { timeoutMs: 30000 })
          if (!alive.current) return
          setItems(asArray(response.consultations).filter(isRecord))
        } catch (failure) {
          if (!alive.current) return
          setError(failure && failure.message ? failure.message : String(failure))
        } finally {
          if (alive.current) setLoading(false)
        }
      }

      async function deleteHistory(id) {
        setDeleting(id)
        setError(null)
        try {
          await apiRequest('history/delete', { method: 'POST', body: { id: id }, timeoutMs: 30000 })
          if (!alive.current) return
          setItems(function (previous) {
            if (previous === null) return previous
            return previous.filter(function (item) {
              return (asString(item.consultationId) || asString(item.id)) !== id
            })
          })
        } catch (failure) {
          if (!alive.current) return
          setError(failure && failure.message ? failure.message : String(failure))
        } finally {
          if (alive.current) setDeleting(null)
        }
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        h(
          'div',
          { className: 'ecs-toolbar' },
          h(
            'button',
            {
              type: 'button',
              className: 'ecs-btn',
              disabled: loading,
              onClick: function onClick() {
                loadHistory()
              },
            },
            loading ? t('history.loading') : t('history.load'),
          ),
          h(
            'span',
            { className: 'ecs-hint' },
            t('history.hint'),
          ),
        ),
        error !== null ? h('div', { className: 'ecs-note', 'data-kind': 'error' }, error) : null,
        items === null
          ? null
          : items.length === 0
            ? h('div', { className: 'ecs-empty' }, t('history.empty'))
            : items.map(function (item, index) {
                const id = asString(item.consultationId) || asString(item.id) || 'row-' + index
                return h(HistoryRow, {
                  key: id,
                  summary: item,
                  busy: deleting === id,
                  onDelete: function onDelete(target) {
                    deleteHistory(target)
                  },
                })
              }),
      )
    }

    function HostInfo(props) {
      const state = props.state
      if (state === null) return null
      const security = asRecord(state.security)
      const store = asRecord(state.store)
      const rows = []
      if (store !== null) {
        rows.push([t('host.storePath'), asString(store.path)])
        rows.push([t('host.records'), asNumber(store.count) === null ? null : String(store.count)])
        rows.push([t('host.bytes'), formatBytes(store.bytes)])
        rows.push([t('host.orphans'), asNumber(store.orphans) === null ? null : String(store.orphans)])
      }
      if (security !== null) {
        rows.push([t('host.allowedHosts'), strings(security.allowedHosts).join(', ') || t('common.none')])
        rows.push([
          t('host.trustedLocalEndpoints'),
          strings(security.trustedLocalEndpoints).join(', ') || t('common.none'),
        ])
        rows.push([
          t('host.maxPayload'),
          asNumber(security.maxPayloadBytes) === null ? null : formatBytes(security.maxPayloadBytes),
        ])
        rows.push([
          t('host.redaction'),
          security.redactSecrets === true ? t('settings.enabled') : t('settings.disabled'),
        ])
        rows.push([t('host.repoScope'), security.allowRepoScope === true ? t('settings.allowed') : t('host.refused')])
      }
      if (rows.length === 0) return null
      return h(
        'div',
        { className: 'ecs-card' },
        h('div', { className: 'ecs-card-head' }, h('span', { className: 'ecs-card-title' }, t('host.title'))),
        h('div', { className: 'ecs-row' }, h(KV, { rows: rows })),
      )
    }

    function SettingsSection() {
      useLocaleRevision()
      const [state, setState] = useState(null)
      const [drafts, setDrafts] = useState({})
      const [baselines, setBaselines] = useState({})
      const [loading, setLoading] = useState(true)
      const [loadError, setLoadError] = useState(null)
      const [busy, setBusy] = useState({})
      const [notes, setNotes] = useState({})
      const [tests, setTests] = useState({})
      const alive = useRef(true)

      useEffect(function () {
        alive.current = true
        return function cleanup() {
          alive.current = false
        }
      }, [])

      function adoptState(next) {
        const slots = asArray(next.slots)
        const nextDrafts = {}
        const nextBaselines = {}
        slots.forEach(function (slot) {
          if (!isRecord(slot)) return
          const id = asString(slot.slot)
          if (id === null) return
          const draft = draftFromSlot(slot)
          nextDrafts[id] = draft
          nextBaselines[id] = draft
        })
        setState(next)
        setDrafts(nextDrafts)
        setBaselines(nextBaselines)
      }

      async function load(showSpinner) {
        if (showSpinner) setLoading(true)
        try {
          const next = await apiRequest('state', { timeoutMs: 30000 })
          if (!alive.current) return
          adoptState(next)
          setLoadError(null)
        } catch (error) {
          if (!alive.current) return
          setLoadError(error && error.message ? error.message : String(error))
        } finally {
          if (alive.current) setLoading(false)
        }
      }

      useEffect(function () {
        load(true)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      function setBusyFor(slotId, value) {
        setBusy(function (previous) {
          const next = Object.assign({}, previous)
          if (value === null) delete next[slotId]
          else next[slotId] = value
          return next
        })
      }

      function setNoteFor(slotId, note) {
        setNotes(function (previous) {
          const next = Object.assign({}, previous)
          if (note === null) delete next[slotId]
          else next[slotId] = note
          return next
        })
      }

      function changeDraft(slotId, name, value) {
        setDrafts(function (previous) {
          const current = previous[slotId]
          if (current === undefined) return previous
          const next = Object.assign({}, previous)
          next[slotId] = Object.assign({}, current, { [name]: value })
          return next
        })
        setNoteFor(slotId, null)
      }

      async function saveSlot(slotId) {
        const draft = drafts[slotId]
        if (draft === undefined) return
        const built = buildSlotPatch(draft)
        if (!built.ok) {
          setNoteFor(slotId, { kind: 'error', text: built.message })
          return
        }
        setBusyFor(slotId, 'save')
        setNoteFor(slotId, null)
        try {
          const response = await apiRequest('slot', {
            method: 'POST',
            body: { slot: slotId, patch: built.patch },
            timeoutMs: 30000,
          })
          if (!alive.current) return
          // POST /expert-council/slot answers with the complete state document
          // (same shape as GET /state). Older/alternate hosts may wrap it in
          // `state`; accept both, and reload when neither shape is present.
          const wrapped = asRecord(response.state)
          const inline = Array.isArray(response.slots) ? response : null
          const nextState = wrapped !== null ? wrapped : inline
          if (nextState !== null) adoptState(nextState)
          else await load(false)
          if (!alive.current) return
          setNoteFor(slotId, { kind: 'ok', text: t('settings.saved') })
        } catch (error) {
          if (!alive.current) return
          setNoteFor(slotId, { kind: 'error', text: error && error.message ? error.message : String(error) })
        } finally {
          if (alive.current) setBusyFor(slotId, null)
        }
      }

      async function saveKey(slotId) {
        const draft = drafts[slotId]
        if (draft === undefined) return
        const apiKey = String(draft.apiKey || '').trim()
        if (apiKey === '') {
          setNoteFor(slotId, { kind: 'error', text: t('settings.enterApiKey') })
          return
        }
        setBusyFor(slotId, 'key')
        setNoteFor(slotId, null)
        try {
          await apiRequest('credential', {
            method: 'POST',
            body: { slot: slotId, apiKey: apiKey },
            timeoutMs: 30000,
          })
          if (!alive.current) return
          setDrafts(function (previous) {
            const current = previous[slotId]
            if (current === undefined) return previous
            const next = Object.assign({}, previous)
            next[slotId] = Object.assign({}, current, { apiKey: '' })
            return next
          })
          await load(false)
          if (!alive.current) return
          setNoteFor(slotId, { kind: 'ok', text: t('settings.keyStored') })
        } catch (error) {
          if (!alive.current) return
          setNoteFor(slotId, { kind: 'error', text: error && error.message ? error.message : String(error) })
        } finally {
          if (alive.current) setBusyFor(slotId, null)
        }
      }

      async function removeKey(slotId) {
        setBusyFor(slotId, 'remove-key')
        setNoteFor(slotId, null)
        try {
          await apiRequest('credential', {
            method: 'DELETE',
            body: { slot: slotId },
            timeoutMs: 30000,
          })
          if (!alive.current) return
          await load(false)
          if (!alive.current) return
          setNoteFor(slotId, { kind: 'ok', text: t('settings.keyRemoved') })
        } catch (error) {
          if (!alive.current) return
          setNoteFor(slotId, { kind: 'error', text: error && error.message ? error.message : String(error) })
        } finally {
          if (alive.current) setBusyFor(slotId, null)
        }
      }

      async function testSlot(slotId) {
        setBusyFor(slotId, 'test')
        setNoteFor(slotId, null)
        setTests(function (previous) {
          const next = Object.assign({}, previous)
          delete next[slotId]
          return next
        })
        try {
          const response = await apiRequest('test', {
            method: 'POST',
            body: { slot: slotId },
            timeoutMs: 180000,
          })
          if (!alive.current) return
          const result = asRecord(response.result)
          if (result !== null) {
            setTests(function (previous) {
              const next = Object.assign({}, previous)
              next[slotId] = result
              return next
            })
            setNoteFor(slotId, {
              kind: result.ok === true ? 'ok' : 'warn',
              text: result.ok === true ? t('settings.testOk') : t('settings.testFailed'),
            })
          } else {
            setNoteFor(slotId, { kind: 'warn', text: t('settings.noTestResult') })
          }
        } catch (error) {
          if (!alive.current) return
          setNoteFor(slotId, { kind: 'error', text: error && error.message ? error.message : String(error) })
        } finally {
          if (alive.current) setBusyFor(slotId, null)
        }
      }

      const slots = (state === null ? [] : asArray(state.slots).filter(isRecord)).slice().sort(function (left, right) {
        const a = SLOT_IDS.indexOf(asString(left.slot))
        const b = SLOT_IDS.indexOf(asString(right.slot))
        return (a < 0 ? 99 : a) - (b < 0 ? 99 : b)
      })
      const warnings = state === null ? [] : strings(state.warnings)
      const advertised = state === null ? [] : strings(state.protocols)
      const protocols =
        advertised.length > 0
          ? advertised
          : ['openai_chat_completions', 'anthropic_messages']

      return h(
        'div',
        { className: 'ecs-page' },
        h(
          'div',
          { className: 'ecs-header' },
          h('div', { className: 'ecs-title' }, t('settings.title')),
          h('div', { className: 'ecs-desc' }, t('settings.description')),
        ),
        h(
          'div',
          { className: 'ecs-toolbar' },
          h(
            'button',
            {
              type: 'button',
              className: 'ecs-btn',
              disabled: loading,
              onClick: function onClick() {
                load(true)
              },
            },
            loading ? t('settings.refreshing') : t('settings.refresh'),
          ),
          state !== null && isRecord(state.defaults)
            ? h(
                'span',
                { className: 'ecs-hint' },
                t('settings.defaultsLine', {
                  slot: asString(state.defaults.singleSlot) || t('common.unknown'),
                  council: state.defaults.allowCouncil === true ? t('settings.allowed') : t('settings.disabled'),
                }),
              )
            : null,
          state !== null && asNumber(state.version) !== null
            ? h('span', { className: 'ecs-hint' }, t('settings.stateVersion', { version: state.version }))
            : null,
        ),
        loadError !== null
          ? h(
              'div',
              { className: 'ecs-banner' },
              h('div', null, t('settings.loadFailed', { message: loadError })),
              h('div', { className: 'ecs-hint' }, t('settings.loadFailedHint')),
            )
          : null,
        warnings.length > 0
          ? h(
              'div',
              { className: 'ecs-banner' },
              h('div', null, t('settings.hostWarnings')),
              warnings.map(function (warning, index) {
                return h('div', { key: index, className: 'ecs-hint' }, warning)
              }),
            )
          : null,
        loading && state === null
          ? h('div', { className: 'ecs-empty' }, t('settings.loadingState'))
          : slots.length === 0 && loadError === null
            ? h('div', { className: 'ecs-empty' }, t('settings.noSlots'))
            : slots.map(function (slot) {
                const slotId = asString(slot.slot) || '?'
                return h(SlotEditor, {
                  key: slotId,
                  slot: slot,
                  state: state,
                  draft: drafts[slotId] || draftFromSlot(slot),
                  baseline: baselines[slotId] === undefined ? null : baselines[slotId],
                  busy: busy[slotId] === undefined ? null : busy[slotId],
                  note: notes[slotId] === undefined ? null : notes[slotId],
                  testResult: tests[slotId] === undefined ? null : tests[slotId],
                  onChange: function onChange(name, value) {
                    changeDraft(slotId, name, value)
                  },
                  onSave: function onSave() {
                    saveSlot(slotId)
                  },
                  onSaveKey: function onSaveKey() {
                    saveKey(slotId)
                  },
                  onRemoveKey: function onRemoveKey() {
                    removeKey(slotId)
                  },
                  protocols: protocols,
                  onTest: function onTest() {
                    testSlot(slotId)
                  },
                })
              }),
        h('div', { className: 'ecs-hint' }, t('settings.footer')),
        h(HostInfo, { state: state }),
        h(HistorySection, null),
      )
    }

    // ------------------------------------------------------------------
    // Plugin apply
    // ------------------------------------------------------------------

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposeStyles = installStyles()
        if (typeof ctx.effect === 'function') {
          ctx.effect(function () {
            return disposeStyles
          })
        }

        // --- Locale -----------------------------------------------------
        // `locale` stays OUT of the module-level `inject` list on purpose: a
        // required dependency would make the whole plugin disappear on a host
        // that lacks it, while this optional path degrades to the built-in
        // English dictionary.
        //
        // But it must not be read once and forgotten either. A client plugin
        // activates as soon as its own inject list is satisfied, and the locale
        // service is a separate client plugin that may register afterwards —
        // reading `ctx.get('locale')` only here is exactly what left the UI on
        // the English fallback. So the service is resolved through three paths:
        //   1. immediately, for the common case where it is already active;
        //   2. reactively, through `ctx.inject(['locale'], ...)` when it arrives
        //      later (the idiom the shipped locale-aware plugins use);
        //   3. lazily, from `t()` on every render, as a final safety net.
        let dictionariesRegistered = false
        resolveLocaleService = function resolveLocaleService() {
          if (typeof ctx.get !== 'function') return undefined
          return ctx.get('locale')
        }

        function registerDictionaries(scope, service) {
          if (dictionariesRegistered) return
          if (service === null || service === undefined || typeof service.register !== 'function') return
          dictionariesRegistered = true
          // register() rejects a duplicate (ns, locale) pair, so each call is
          // owned by an effect and never re-run.
          const run = function (locale, dictionary, label) {
            const start = function () {
              return service.register(NAMESPACE, locale, dictionary)
            }
            if (typeof scope.effect === 'function') scope.effect(start, label)
            else start()
          }
          run('en', MESSAGES_EN, 'dsh-expert-council: locale en')
          run('zh', MESSAGES_ZH, 'dsh-expert-council: locale zh')
        }

        const immediate = resolveLocaleService()
        if (attachLocale(immediate)) registerDictionaries(ctx, immediate)

        if (typeof ctx.inject === 'function') {
          try {
            ctx.inject(['locale'], function (scope) {
              const service = scope.locale
              attachLocale(service)
              registerDictionaries(scope, service)
            })
          } catch (error) {
            // A host that cannot express this inject simply keeps the fallback.
          }
        }

        function registerToolView(key, component) {
          ctx.slots.inject('tool.call.toolview', function () {
            return ctx.slots.register(
              {
                name: 'tool.call.toolview',
                key: key,
              },
              component,
            )
          })
        }

        registerToolView('consult_expert', ConsultExpertView)
        registerToolView('consult_council', ConsultCouncilView)
        registerToolView('followup_expert', FollowupExpertView)
        registerToolView('verify_consultation', VerifyConsultationView)

        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            {
              name: 'settings.section',
              id: 'expert-council',
              order: 50,
              // A thunk, so the nav label re-reads the active locale on every
              // projection instead of freezing the string at registration.
              label: function navLabel() {
                return t('settings.navLabel')
              },
            },
            SettingsSection,
          )
        })
      },
      // Test seam used by plugin/src/client/smoke.mjs. The host only reads
      // `inject` and `apply`, so these extra keys are inert at runtime.
      __test: {
        normalizeMeta: normalizeMeta,
        normalizeSynthesis: normalizeSynthesis,
        buildSlotPatch: buildSlotPatch,
        draftFromSlot: draftFromSlot,
        credentialStateOf: credentialStateOf,
        copyCouncilReport: copyCouncilReport,
        copySingleReport: copySingleReport,
        councilCostTotal: councilCostTotal,
        councilReturned: councilReturned,
        formatCost: formatCost,
        formatDuration: formatDuration,
        contentText: contentText,
        apiRequest: apiRequest,
        setApiBase: function setApiBase(base) {
          apiBase = base
        },
        messages: {
          en: MESSAGES_EN,
          zh: MESSAGES_ZH,
          namespace: NAMESPACE,
        },
        components: {
          ConsultExpertView: ConsultExpertView,
          ConsultCouncilView: ConsultCouncilView,
          FollowupExpertView: FollowupExpertView,
          VerifyConsultationView: VerifyConsultationView,
          SettingsSection: SettingsSection,
          SlotEditor: SlotEditor,
          HistorySection: HistorySection,
          HistoryRow: HistoryRow,
          HostInfo: HostInfo,
        },
      },
    }
  },
})
