import Image from 'next/image'
import { isOptimizableImage } from '@/lib/blog/shared'

/**
 * Cover image in a fixed 16:9 box (no layout shift). Vercel Blob URLs go through
 * next/image (host whitelisted in next.config.js); any other https URL is a plain <img>.
 */
export function BlogCover({
  src,
  alt,
  priority = false,
  sizes = '(min-width: 1024px) 768px, 100vw',
  className = '',
}: {
  src: string
  alt: string
  priority?: boolean
  sizes?: string
  className?: string
}) {
  return (
    <div className={`relative aspect-[16/9] w-full overflow-hidden bg-muted ${className}`}>
      {isOptimizableImage(src) ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- host not in images.remotePatterns
        <img
          src={src}
          alt={alt}
          width={1600}
          height={900}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  )
}
