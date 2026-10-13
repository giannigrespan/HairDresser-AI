import type { NextConfig } from 'next';

const config: NextConfig = {
  // Il prompt viene letto da file a runtime: va incluso nel bundle delle funzioni.
  outputFileTracingIncludes: { '/api/whatsapp': ['./prompts/**/*'] },
};

export default config;
