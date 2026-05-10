// src/core/config/schema.ts
export const coreConfigSchema = {
  type: "object",
  required: ["input", "http", "logging"],
  properties: {
    input: {
      oneOf: [
        {
          type: "object",
          required: ["type", "port"],
          properties: {
            type: { const: "udp" },
            port: { type: "integer", minimum: 1, maximum: 65535 },
            host: { type: "string" },
            game: { enum: ["fh5", "fh6"] },
          },
          additionalProperties: false,
        },
        {
          type: "object",
          required: ["type", "file"],
          properties: {
            type: { const: "mock" },
            file: { type: "string", minLength: 1 },
            loop: { type: "boolean" },
            speed: { type: "number", exclusiveMinimum: 0 },
            game: { enum: ["fh5", "fh6"] },
          },
          additionalProperties: false,
        },
      ],
    },
    rawOutputs: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type", "host", "port", "enabled"],
        properties: {
          name: { type: "string", minLength: 1 },
          type: { const: "udp-forward" },
          host: { type: "string", minLength: 1 },
          port: { type: "integer", minimum: 1, maximum: 65535 },
          enabled: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    http: {
      type: "object",
      required: ["port"],
      properties: {
        port: { type: "integer", minimum: 1, maximum: 65535 },
      },
      additionalProperties: false,
    },
    logging: {
      type: "object",
      required: ["level", "dir"],
      properties: {
        level: { enum: ["trace", "debug", "info", "warn", "error"] },
        dir: { type: "string", minLength: 1 },
        pretty: { type: "boolean" },
      },
      additionalProperties: false,
    },
    modules: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["enabled"],
        properties: {
          enabled: { type: "boolean" },
          config: {},
        },
      },
    },
  },
  additionalProperties: false,
} as const;
