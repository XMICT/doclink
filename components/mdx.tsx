import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Cards } from 'fumadocs-ui/components/card';
import { CardWithIcon as Card } from './card-with-icon';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Callout } from 'fumadocs-ui/components/callout';
import { Mermaid } from './mermaid';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Callout,
    Card,
    Cards,
    Mermaid,
    Accordion,
    Accordions,
    Steps,
    Step,
    Tabs,
    Tab,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
