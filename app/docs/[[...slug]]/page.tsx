import { getPageImage, getPageMarkdownUrl, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound, redirect } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { gitConfig } from '@/lib/shared';
import { OpenAPIPageClient } from '@/components/openapi-page';
import type { OpenAPIPageData } from 'fumadocs-openapi/server';

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;

  if (!params.slug || params.slug.length === 0) {
    const first = source.getPages()[0];
    redirect(first ? first.url : '/');
  }

  const page = source.getPage(params.slug);
  if (!page) notFound();

  // Página OpenAPI virtual (inyectada por loaderPlugin, sin body MDX)
  if ('_openapi' in page.data) {
    const apiData = page.data as unknown as OpenAPIPageData;
    const pageProps = apiData.getOpenAPIPageProps();
    return (
      <DocsPage toc={apiData.toc} full={true}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsBody>
          <OpenAPIPageClient {...pageProps} />
        </DocsBody>
      </DocsPage>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mdxData = page.data as any;
  const MDX = mdxData.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  return (
    <DocsPage toc={mdxData.toc} full={mdxData.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImage(page).url,
    },
  };
}
