import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from '../footer'

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      forCandidates: 'For Candidates',
      browseJobs: 'Browse Jobs',
      createCV: 'Create CV',
      careerAdvice: 'Career Advice',
      forEmployers: 'For Employers',
      postJob: 'Post a Job',
      pricing: 'Pricing',
      atsFeatures: 'ATS Features',
      company: 'Company',
      about: 'About Us',
      contact: 'Contact',
      blog: 'Blog',
      footerLink: 'FAQ',
      legal: 'Legal',
      privacy: 'Privacy Policy',
      terms: 'Terms of Service',
      gdpr: 'GDPR',
      tagline: 'The modern ATS for modern teams',
      allRightsReserved: 'All rights reserved.',
    }
    return translations[key] || key
  },
  useLocale: () => 'en',
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ alt, ...props }: any) => <img alt={alt} {...props} />,
}))

describe('Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render footer with all sections', () => {
    render(<Footer />)

    expect(screen.getByText('For Candidates')).toBeInTheDocument()
    expect(screen.getByText('For Employers')).toBeInTheDocument()
    expect(screen.getByText('Company')).toBeInTheDocument()
    expect(screen.getByText('Legal')).toBeInTheDocument()
  })

  it('should render for candidates section links', () => {
    render(<Footer />)

    expect(screen.getByText('Browse Jobs')).toBeInTheDocument()
    expect(screen.getByText('Create CV')).toBeInTheDocument()
    expect(screen.getByText('Career Advice')).toBeInTheDocument()
  })

  it('should render for employers section links', () => {
    render(<Footer />)

    expect(screen.getByText('Post a Job')).toBeInTheDocument()
    expect(screen.getByText('Pricing')).toBeInTheDocument()
    expect(screen.getByText('ATS Features')).toBeInTheDocument()
  })

  it('should render company section links', () => {
    render(<Footer />)

    expect(screen.getByText('About Us')).toBeInTheDocument()
    expect(screen.getByText('Contact')).toBeInTheDocument()
    expect(screen.getByText('Blog')).toBeInTheDocument()
  })

  it('should render legal section links', () => {
    render(<Footer />)

    expect(screen.getByText('Privacy Policy')).toBeInTheDocument()
    expect(screen.getByText('Terms of Service')).toBeInTheDocument()
    expect(screen.getByText('GDPR')).toBeInTheDocument()
  })

  it('should have correct href for candidate links', () => {
    render(<Footer />)

    const browseJobsLink = screen.getByText('Browse Jobs').closest('a')
    expect(browseJobsLink).toHaveAttribute('href', '/en/jobs')

    const createCVLink = screen.getByText('Create CV').closest('a')
    expect(createCVLink).toHaveAttribute('href', '/en/create-cv')

    const careerAdviceLink = screen.getByText('Career Advice').closest('a')
    expect(careerAdviceLink).toHaveAttribute('href', '/en/career-advice')
  })

  it('should have correct href for employer links', () => {
    render(<Footer />)

    const postJobLink = screen.getByText('Post a Job').closest('a')
    expect(postJobLink).toHaveAttribute('href', '/en/post-job')

    const pricingLink = screen.getByText('Pricing').closest('a')
    expect(pricingLink).toHaveAttribute('href', '/en/pricing')

    const featuresLink = screen.getByText('ATS Features').closest('a')
    expect(featuresLink).toHaveAttribute('href', '/en/features')
  })

  it('should have correct href for company links', () => {
    render(<Footer />)

    const aboutLink = screen.getByText('About Us').closest('a')
    expect(aboutLink).toHaveAttribute('href', '/en/about')

    const contactLink = screen.getByText('Contact').closest('a')
    expect(contactLink).toHaveAttribute('href', '/en/contact')

    const blogLink = screen.getByText('Blog').closest('a')
    expect(blogLink).toHaveAttribute('href', '/en/blog')
  })

  it('should have correct href for legal links', () => {
    render(<Footer />)

    const privacyLink = screen.getByText('Privacy Policy').closest('a')
    expect(privacyLink).toHaveAttribute('href', '/en/privacy')

    const termsLink = screen.getByText('Terms of Service').closest('a')
    expect(termsLink).toHaveAttribute('href', '/en/terms')

    const gdprLink = screen.getByText('GDPR').closest('a')
    expect(gdprLink).toHaveAttribute('href', '/en/gdpr')
  })

  it('should render company branding logo', () => {
    render(<Footer />)

    const logo = screen.getByAltText('JobSphere')
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveAttribute('src', '/images/jobsphere_logo.png')
  })

  it('should render tagline', () => {
    render(<Footer />)

    expect(screen.getByText('The modern ATS for modern teams')).toBeInTheDocument()
  })

  it('should render copyright with current year', () => {
    render(<Footer />)

    const currentYear = new Date().getFullYear()
    const copyright = screen.getByText(new RegExp(`© ${currentYear} JobSphere`))
    expect(copyright).toBeInTheDocument()
  })

  it('should render all rights reserved text', () => {
    render(<Footer />)

    expect(screen.getByText(/All rights reserved/)).toBeInTheDocument()
  })

  it('should have 4 footer sections', () => {
    const { container } = render(<Footer />)

    const sections = container.querySelectorAll('h3')
    expect(sections).toHaveLength(4)
  })

  it('should render all 13 links (3 per section, plus FAQ under Company)', () => {
    const { container } = render(<Footer />)

    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(13)
    expect(container.querySelector('a[href="/en/faq"]')).toHaveTextContent('FAQ')
  })
})
