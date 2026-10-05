'use client';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';
import type { OpenAPIPageProps } from 'fumadocs-openapi/ui';
import type { CreateOpenAPIPageOptions } from 'fumadocs-openapi/ui';
import type { ResultDisplayProps } from 'fumadocs-openapi/playground/client';
import { DefaultResultDisplay } from 'fumadocs-openapi/playground/client';
import { useMemo } from 'react';

const MAX_LINES = 200;
type MediaAdapter = NonNullable<CreateOpenAPIPageOptions['mediaAdapters']>[string];

const binaryMediaAdapter: MediaAdapter = {
  encode: ({ body }) => body as BodyInit,
  generateExample: () => undefined,
};

function processBody(body: ArrayBuffer, contentType: string): ArrayBuffer {
  if (body.byteLength === 0) return body;

  const isJson = contentType.includes('json') || contentType.includes('+json');
  let text = new TextDecoder('utf-8').decode(body);

  if (isJson) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // not valid JSON, use as-is
    }
  }

  const lines = text.split('\n');
  if (lines.length > MAX_LINES) {
    text =
      lines.slice(0, MAX_LINES).join('\n') +
      `\n\n// ... respuesta truncada (${lines.length - MAX_LINES} líneas omitidas)`;
  }

  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function TruncatedResultDisplay({ data, reset, ...rest }: ResultDisplayProps) {
  const processedData = useMemo(() => {
    if (data.type !== 'response' || data.body.byteLength === 0) return data;
    const contentType = data.headers.get('Content-Type') ?? '';
    return { ...data, body: processBody(data.body, contentType) };
  }, [data]);

  return <DefaultResultDisplay data={processedData} reset={reset} {...rest} />;
}

const OpenAPIPage = createOpenAPIPage({
  mediaAdapters: {
    'image/jpeg': binaryMediaAdapter,
    'image/png': binaryMediaAdapter,
    'application/pdf': binaryMediaAdapter,
  },
  playground: {
    components: {
      ResultDisplay: TruncatedResultDisplay,
    },
  },
});

export function OpenAPIPageClient(props: OpenAPIPageProps) {
  return <OpenAPIPage {...props} />;
}
