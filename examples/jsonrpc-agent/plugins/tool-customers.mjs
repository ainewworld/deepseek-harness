/**
 * Business tool bridge: expose the host application's customer data to the
 * embedded DSH agent as two model-facing tools:
 *  - `query_customers` — filtered read access to the customer list
 *  - `import_customers` — bulk JSON/YAML import through the same validation
 *    pipeline the portal's import feature uses (POST /api/customers/import).
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
}
