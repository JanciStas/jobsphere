import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Header } from '../header'

// The mobile drawer is a Radix dialog; its scroll-lock layer expects
// ResizeObserver, which happy-dom does not implement.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      'nav.home': 'Home',
      'nav.jobs': 'Jobs',
      'nav.companies': 'Company Profiles',
      'nav.freelancers': 'Freelancers',
      'nav.gigs': 'Gigs',
      'nav.forEmployers': 'For Employers',
      'nav.pricing': 'Pricing',
      'nav.login': 'Log In',
      'nav.signup': 'Sign Up',
      'nav.siteHeader': 'Site header',
      'nav.mobileNavigation': 'Mobile navigation',
      'nav.mainNavigation': 'Main navigation',
      'nav.userActions': 'User actions',
      'nav.homeAria': 'JobSphere home',
      'nav.openMenu': 'Open main menu',
    }
    return translations[key] || key
  },
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/en',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

// Mock LanguageSwitcher
vi.mock('../language-switcher', () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher">Language Switcher</div>,
}))

// Mock Button component
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild, ...props }: any) => {
    if (asChild) {
      return <div {...props}>{children}</div>
    }
    return <button {...props}>{children}</button>
  },
}))

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render header with logo', () => {
    render(<Header />)

    const logoLink = screen.getByRole('link', { name: /JobSphere home/i })
    expect(logoLink).toBeInTheDocument()
  })

  it('should have proper ARIA attributes', () => {
    render(<Header />)

    const header = screen.getByRole('banner')
    expect(header).toHaveAttribute('aria-label', 'Site header')
  })

  it('should render main navigation links', () => {
    render(<Header />)

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Jobs')).toBeInTheDocument()
    expect(screen.getByText('For Employers')).toBeInTheDocument()
    expect(screen.getByText('Pricing')).toBeInTheDocument()
  })

  it('should render language switcher', () => {
    render(<Header />)

    expect(screen.getByTestId('language-switcher')).toBeInTheDocument()
  })

  it('should render login and signup buttons', () => {
    render(<Header />)

    expect(screen.getByText('Log In')).toBeInTheDocument()
    expect(screen.getByText('Sign Up')).toBeInTheDocument()
  })

  it('should have correct href for navigation links', () => {
    render(<Header />)

    const homeLink = screen.getByText('Home').closest('a')
    expect(homeLink).toHaveAttribute('href', '/en')

    const jobsLink = screen.getByText('Jobs').closest('a')
    expect(jobsLink).toHaveAttribute('href', '/en/jobs')

    const employersLink = screen.getByText('For Employers').closest('a')
    expect(employersLink).toHaveAttribute('href', '/en/for-employers')

    const pricingLink = screen.getByText('Pricing').closest('a')
    expect(pricingLink).toHaveAttribute('href', '/en/pricing')
  })

  it('should have correct href for login button', () => {
    render(<Header />)

    const loginLink = screen.getByText('Log In').closest('a')
    expect(loginLink).toHaveAttribute('href', '/en/login')
  })

  it('should have correct href for signup button', () => {
    render(<Header />)

    const signupLink = screen.getByText('Sign Up').closest('a')
    expect(signupLink).toHaveAttribute('href', '/en/signup')
  })

  it('should have navigation with proper aria-label', () => {
    render(<Header />)

    const mainNav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(mainNav).toBeInTheDocument()

    const userActions = screen.getByRole('navigation', { name: 'User actions' })
    expect(userActions).toBeInTheDocument()
  })

  it('should render logo with proper aria-label', () => {
    render(<Header />)

    const logoLink = screen.getByLabelText('JobSphere home')
    expect(logoLink).toBeInTheDocument()
    expect(logoLink).toHaveAttribute('href', '/en')
  })

  it('should render login link named by its visible (translated) text', () => {
    render(<Header />)

    // No hardcoded English aria-label: accessible name must equal visible text (WCAG 2.5.3)
    const loginLink = screen.getByRole('link', { name: 'Log In' })
    expect(loginLink).toBeInTheDocument()
    expect(loginLink).not.toHaveAttribute('aria-label')
  })

  it('should render signup link named by its visible (translated) text', () => {
    render(<Header />)

    const signupLink = screen.getByRole('link', { name: 'Sign Up' })
    expect(signupLink).toBeInTheDocument()
    expect(signupLink).not.toHaveAttribute('aria-label')
  })

  describe('mobile navigation drawer', () => {
    // Below `md` the desktop <nav> is display:none, so without this drawer the
    // whole main navigation is unreachable on a phone.
    it('should render a hamburger trigger with aria-label and aria-expanded', () => {
      render(<Header />)

      const trigger = screen.getByLabelText('Open main menu')
      expect(trigger).toBeInTheDocument()
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })

    it('should not render the drawer navigation until the trigger is used', () => {
      render(<Header />)

      expect(
        screen.queryByRole('navigation', { name: 'Mobile navigation' }),
      ).not.toBeInTheDocument()
    })

    it('should expose every main nav link through the drawer', () => {
      render(<Header />)

      fireEvent.click(screen.getByLabelText('Open main menu'))

      const drawerNav = screen.getByRole('navigation', { name: 'Mobile navigation' })
      const drawer = within(drawerNav)

      // Same labels and hrefs as the desktop nav — both map the one `navItems` array.
      expect(drawer.getByText('Home').closest('a')).toHaveAttribute('href', '/en')
      expect(drawer.getByText('Jobs').closest('a')).toHaveAttribute('href', '/en/jobs')
      expect(drawer.getByText('Company Profiles').closest('a')).toHaveAttribute(
        'href',
        '/en/companies',
      )
      expect(drawer.getByText('Freelancers').closest('a')).toHaveAttribute(
        'href',
        '/en/freelancers',
      )
      expect(drawer.getByText('Gigs').closest('a')).toHaveAttribute('href', '/en/gigs')
      expect(drawer.getByText('For Employers').closest('a')).toHaveAttribute(
        'href',
        '/en/for-employers',
      )
      expect(drawer.getByText('Pricing').closest('a')).toHaveAttribute('href', '/en/pricing')

      expect(drawer.getAllByRole('link')).toHaveLength(7)
    })

    it('should mark the trigger expanded and the drawer modal while open', () => {
      render(<Header />)

      fireEvent.click(screen.getByLabelText('Open main menu'))

      expect(screen.getByLabelText('Open main menu')).toHaveAttribute('aria-expanded', 'true')

      // Radix names the dialog from its (visually hidden) title.
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      expect(dialog).toHaveAttribute('data-state', 'open')
      expect(screen.getByLabelText('Close menu')).toBeInTheDocument()
    })

    it('should close on navigation', () => {
      render(<Header />)

      fireEvent.click(screen.getByLabelText('Open main menu'))
      const drawerNav = screen.getByRole('navigation', { name: 'Mobile navigation' })
      fireEvent.click(within(drawerNav).getByText('Jobs'))

      expect(
        screen.queryByRole('navigation', { name: 'Mobile navigation' }),
      ).not.toBeInTheDocument()
      expect(screen.getByLabelText('Open main menu')).toHaveAttribute('aria-expanded', 'false')
    })

    it('should close on Escape', () => {
      render(<Header />)

      fireEvent.click(screen.getByLabelText('Open main menu'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should keep the desktop navigation intact alongside the drawer', () => {
      render(<Header />)

      const mainNav = screen.getByRole('navigation', { name: 'Main navigation' })
      expect(within(mainNav).getAllByRole('link')).toHaveLength(7)
    })
  })
})
