import {headers} from 'next/headers';
import localFont from 'next/font/local';
import './checkout.css';
import {brandIcon, checkoutLanguage, themeBootstrap} from './appearance.js';

const brandFont = localFont({
  src:'./fonts/dm-sans-latin.woff2', variable:'--font-brand', weight:'100 1000', display:'swap', adjustFontFallback:false,
});

export const metadata = { title:'Developer pass · 0to1pay', icons:{icon:brandIcon} };

export default async function Layout({children}) {
  const accepted = (await headers()).get('accept-language') || '';
  return <html className={brandFont.variable} lang={checkoutLanguage(null, accepted)} suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{__html:themeBootstrap}}/>
      <noscript><style>{'.theme-toggle,.checkout button,.checkout form{display:none}'}</style></noscript>
    </head>
    <body>{children}</body>
  </html>;
}
