'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { CreditCard, Download, ExternalLink, Loader2, Receipt } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface SubscriptionData {
  id: string
  status: string
  currentPeriodStart: string
  currentPeriodEnd: string
  product: {
    name: string
    description?: string
  }
}

interface InvoiceData {
  id: string
  amount: number
  currency: string
  status: string
  pdfUrl?: string | null
  hostedUrl?: string | null
  paidAt?: string | null
  createdAt: string
}

const STATUS_KEYS = ['active', 'trialing', 'past_due', 'canceled', 'unpaid']
const INVOICE_STATUS_KEYS = ['paid', 'open', 'draft', 'void', 'uncollectible']

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  trialing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  past_due: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  canceled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  unpaid: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
}

const INVOICE_STATUS_COLORS = {
  paid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  void: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  uncollectible: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
}

export function BillingTab() {
  const t = useTranslations('settingsTabs.billing')
  const { data: session } = useSession()
  const params = useParams()
  const locale = (params?.locale as string) || 'sk'
  const [loading, setLoading] = useState(true)
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [invoices, setInvoices] = useState<InvoiceData[]>([])
  const [loadingPortal, setLoadingPortal] = useState(false)

  // Fetch billing data
  useEffect(() => {
    async function fetchBillingData() {
      try {
        const response = await fetch('/api/organizations/current/billing')
        if (!response.ok) throw new Error('Failed to fetch billing data')

        const data = await response.json()
        setSubscription(data.subscription)
        setInvoices(data.invoices || [])
      } catch {
        toast.error(t('loadFailed'))
      } finally {
        setLoading(false)
      }
    }

    if (session?.user) {
      fetchBillingData()
    }
  }, [session, toast])

  const handleManageBilling = async () => {
    setLoadingPortal(true)
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) throw new Error('Failed to create portal session')

      const data = await response.json()
      window.location.href = data.url
    } catch {
      toast.error(t('portalFailed'))
      setLoadingPortal(false)
    }
  }

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current Subscription */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t('currentSubscription')}
          </CardTitle>
          <CardDescription>{t('subscriptionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {subscription ? (
            <>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold">
                      {t('planName', { name: subscription.product.name })}
                    </h3>
                    <Badge
                      className={
                        STATUS_COLORS[subscription.status as keyof typeof STATUS_COLORS] || ''
                      }
                    >
                      {(STATUS_KEYS.includes(subscription.status)
                        ? t(`status.${subscription.status}`)
                        : subscription.status.replace('_', ' ')
                      ).toUpperCase()}
                    </Badge>
                  </div>
                  {subscription.product.description && (
                    <p className="text-sm text-muted-foreground">
                      {subscription.product.description}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                    <span>
                      {t('currentPeriod', {
                        start: new Date(subscription.currentPeriodStart).toLocaleDateString(),
                        end: new Date(subscription.currentPeriodEnd).toLocaleDateString(),
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={handleManageBilling} disabled={loadingPortal}>
                    {loadingPortal ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        {t('manageSubscription')}
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <h4 className="font-medium">{t('billingInformation')}</h4>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleManageBilling}
                  disabled={loadingPortal}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  {t('updatePayment')}
                </Button>
                <p className="text-xs text-muted-foreground">{t('portalHint')}</p>
              </div>
            </>
          ) : (
            <div className="py-8 text-center">
              <p className="mb-4 text-muted-foreground">{t('noSubscription')}</p>
              <Button asChild>
                <a href={`/${locale}/pricing`}>{t('viewPlans')}</a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {t('history')}
          </CardTitle>
          <CardDescription>{t('historyDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{t('noInvoices')}</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead>{t('colAmount')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="text-right">{t('colActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        {new Date(invoice.paidAt || invoice.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(invoice.amount, invoice.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            INVOICE_STATUS_COLORS[
                              invoice.status as keyof typeof INVOICE_STATUS_COLORS
                            ] || ''
                          }
                        >
                          {(INVOICE_STATUS_KEYS.includes(invoice.status)
                            ? t(`invoiceStatus.${invoice.status}`)
                            : invoice.status
                          ).toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {invoice.pdfUrl && (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer">
                                <Download className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          {invoice.hostedUrl && (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={invoice.hostedUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
