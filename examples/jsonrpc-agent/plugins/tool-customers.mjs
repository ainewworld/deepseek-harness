/**
 * Business tool bridge: expose the host application's customer data to the
 * embedded DSH agent as three model-facing tools:
 *  - `query_customers` — filtered read access to the customer list
 *  - `import_customers` — bulk JSON/YAML import through the same validation
 *    pipeline the portal's import feature uses (POST /api/customers/import).
 *  - `import_business_card` — recognize a customer from a business-card
 *    image via the backend's vision-LLM recognition endpoint
 *    (POST /api/customers/import/card, autoCommit).
 * The plugin is loaded by the relative entry in app.cordis.yml (relative
 * plugin names resolve beside the configuration file), so it needs no build
 * step and no package installation — bare imports resolve through the
 * examples/node_modules workspace links.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-customers'
export const inject = ['tools']

/**
 * Register the `query_customers` model-facing tool.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment config (baseUrl; falls back to DSH_CUSTOMERS_API,
 *   then http://localhost:8080).
 */
export function apply(ctx, config) {
  const baseUrl = String(
    config?.baseUrl ?? process.env.DSH_CUSTOMERS_API ?? 'http://localhost:8080',
  ).replace(/\/+$/, '')

  ctx.tools.register(defineTool({
    name: 'query_customers',
    description:
      'Query the application\'s customer list (the single source of truth for '
      + 'customer data in this app). Returns every customer with id, name, '
      + 'company, email, and status. Optional `keyword` filters by a '
      + 'case-insensitive substring over name/company/email; optional `status` '
      + 'filters by exact status ("active" or "pending"). Prefer this tool over '
      + 'reading files — customer data does NOT live on the filesystem.',
    parameters: {
      keyword: {
        type: 'string',
        required: true,
        description: 'Case-insensitive substring to match name, company, or email. Use "" (empty string) to return all customers.',
      },
      status: {
        type: 'string',
        required: true,
        enum: ['', 'active', 'pending'],
        description: 'Exact status filter: "active" or "pending". Use "" (empty string) to return all statuses.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          customers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'integer', required: true },
                name: { type: 'string', required: true },
                company: { type: 'string', required: true },
                email: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['active', 'pending'] },
              },
            },
          },
          count: { type: 'integer', required: true },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Queried customer list: ${value.count} of ${value.total} customers matched.`,
      }],
    },
    timeoutMs: 15000,
    async execute(args) {
      let response
      try {
        response = await fetch(`${baseUrl}/api/customers`, {
          signal: AbortSignal.timeout(10000),
          headers: { Accept: 'application/json' },
        })
      } catch (error) {
        throw new Error(`customer API unreachable at ${baseUrl}/api/customers: ${error?.message ?? String(error)}`)
      }
      if (!response.ok) {
        throw new Error(`customer API returned HTTP ${response.status} ${response.statusText}`)
      }
      const all = await response.json()
      if (!Array.isArray(all)) {
        throw new Error('customer API returned a non-array payload')
      }
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : ''
      const status = typeof args.status === 'string' ? args.status : ''
      if (status !== '' && status !== 'active' && status !== 'pending') {
        throw new Error(`invalid status ${JSON.stringify(status)}: use "", "active", or "pending"`)
      }
      const filtered = all.filter((c) => {
        if (status !== '' && c.status !== status) return false
        if (keyword === '') return true
        return [c.name, c.company, c.email]
          .some(field => typeof field === 'string' && field.toLowerCase().includes(keyword))
      })
      return {
        customers: filtered.map(c => ({
          id: c.id,
          name: c.name,
          company: c.company,
          email: c.email,
          status: c.status,
        })),
        count: filtered.length,
        total: all.length,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Query customer list', kind: 'query', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'import_customers',
    description:
      'Bulk-import customers into the application from a JSON or YAML payload'
      + ' (the same pipeline the portal\'s import feature uses). Accepted shapes:'
      + ' a single customer object, an array of customer objects, or'
      + ' { customers: [...] } (YAML equivalents are fine too). Each record is'
      + ' validated independently: records missing a name, with a malformed'
      + ' email, an unknown status ("active"/"pending"), or an email that'
      + ' already exists are skipped and reported in `errors`; every other'
      + ' record is inserted. Use `query_customers` to verify the result.',
    parameters: {
      content: {
        type: 'string',
        required: true,
        description:
          'The full JSON or YAML payload as a string. To import a file, first read it with the filesystem tools, then pass its text here.',
      },
      format: {
        type: 'string',
        enum: ['auto', 'json', 'yaml'],
        description: 'Payload format. Defaults to "auto": JSON when the text starts with { or [, otherwise YAML.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          imported: { type: 'integer', required: true },
          skipped: { type: 'integer', required: true },
          errors: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true },
                name: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Imported ${value.imported} customer(s), skipped ${value.skipped}.`,
      }],
    },
    timeoutMs: 20000,
    async execute(args) {
      const body = JSON.stringify({
        content: String(args.content ?? ''),
        format: args.format || 'auto',
      })
      let response
      try {
        response = await fetch(`${baseUrl}/api/customers/import`, {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
        })
      } catch (error) {
        throw new Error(`customer import API unreachable at ${baseUrl}/api/customers/import: ${error?.message ?? String(error)}`)
      }
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        const message = payload?.message ?? `HTTP ${response.status} ${response.statusText}`
        throw new Error(`customer import rejected: ${message}`)
      }
      return {
        ok: true,
        imported: payload.imported,
        skipped: payload.skipped,
        errors: (payload.errors ?? []).map(e => ({
          index: e.index,
          name: e.name ?? '',
          message: e.message ?? '',
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Import customers', kind: 'import', rawInput: { format: args.format ?? 'auto', contentLength: String(args.content ?? '').length } }),
  }))

  ctx.tools.register(defineTool({
    name: 'import_business_card',
    description:
      'Recognize a customer from a business-card image and import them into'
      + ' the application. The backend sends the image to a vision LLM that'
      + ' extracts name, company, and email; the recognized record is then'
      + ' created through the standard validation path. Returns the recognized'
      + ' fields and the created customer id — always report the recognized'
      + ' fields to the user so they can spot recognition mistakes.'
      + ' Supported image types: png, jpeg, webp (max 8 MB).',
    parameters: {
      imageBase64: {
        type: 'string',
        required: true,
        description:
          'The business-card image bytes, base64-encoded (no data: prefix). '
          + 'When the user pastes a data URL, strip the "data:<mediatype>;base64," prefix first and pass the media type via imageMediaType.',
      },
      imageMediaType: {
        type: 'string',
        required: true,
        enum: ['image/png', 'image/jpeg', 'image/webp'],
        description: 'Image media type. Pass "image/png" when unsure — execute() falls back to it for unknown values.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          committed: { type: 'boolean', required: true },
          id: { type: 'integer' },
          name: { type: 'string', required: true },
          company: { type: 'string', required: true },
          email: { type: 'string', required: true },
          status: { type: 'string', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.committed
          ? `Business card imported: ${value.name} (#${value.id}).`
          : `Business card recognized (not committed): ${value.name}.`,
      }],
    },
    timeoutMs: 60000, // vision LLM round trip can be slow
    async execute(args) {
      const imageBase64 = String(args.imageBase64 ?? '').replace(/^data:[^,]*,/, '')
      if (imageBase64 === '') {
        throw new Error('imageBase64 is empty — pass the base64-encoded card image')
      }
      let response
      try {
        response = await fetch(`${baseUrl}/api/customers/import/card`, {
          method: 'POST',
          signal: AbortSignal.timeout(55000),
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            imageBase64,
            imageMediaType: args.imageMediaType ?? 'image/png',
            autoCommit: true, // agent channel: the user sees recognized fields in the conversation
          }),
        })
      } catch (error) {
        throw new Error(`business-card API unreachable at ${baseUrl}/api/customers/import/card: ${error?.message ?? String(error)}`)
      }
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        const message = payload?.message ?? `HTTP ${response.status} ${response.statusText}`
        throw new Error(`business-card import rejected: ${message}`)
      }
      return {
        ok: true,
        committed: Boolean(payload.committed),
        id: payload.customer?.id,
        name: payload.customer?.name ?? '',
        company: payload.customer?.company ?? '',
        email: payload.customer?.email ?? '',
        status: payload.customer?.status ?? 'pending',
        warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Import business card', kind: 'import', rawInput: { imageMediaType: args.imageMediaType ?? 'image/png', imageBytesApprox: Math.round(String(args.imageBase64 ?? '').length * 3 / 4) } }),
  }))
}
