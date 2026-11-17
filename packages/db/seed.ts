/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, security/detect-object-injection */
import { PrismaClient } from '@prisma/client'
import { faker } from '@faker-js/faker'
import * as bcrypt from 'bcryptjs'
import { assertLocalDatabase } from './assert-local-database'

const prisma = new PrismaClient()

// Slovak regions and cities for Sub-HR model
const REGIONS = {
  BA: { name: 'Bratislava', cities: ['Bratislava', 'Pezinok', 'Malacky', 'Senec'] },
  ZA: { name: 'Žilina', cities: ['Žilina', 'Martin', 'Čadca', 'Dolný Kubín'] },
  KE: { name: 'Košice', cities: ['Košice', 'Prešov', 'Michalovce', 'Spišská Nová Ves'] },
  REMOTE: { name: 'Remote', cities: ['Remote'] },
}

async function seed() {
  // This seed TRUNCATEs core tables (User, Organization, ...) with CASCADE.
  // Refuse to run unless DATABASE_URL points at a plain local database.
  assertLocalDatabase()
  console.log('🌱 Starting seed...')

  // Clear existing data (truncate all main tables)
  await prisma.$executeRaw`TRUNCATE TABLE "User", "Organization", "Candidate", "Job", "Application", "Assessment", "EmailSequence", "Product" CASCADE`

  // Create demo organization
  const org = await prisma.organization.create({
    data: {
      name: 'TechCorp Slovakia',
      slug: 'techcorp-sk',
      website: 'https://techcorp.sk',
      description: 'Leading tech company in Slovakia',
      industry: 'Technology',
      size: '100-500',
      founded: 2015,
      regions: ['BA', 'ZA', 'KE', 'REMOTE'],
      settings: {
        defaultLocale: 'sk',
        timeZone: 'Europe/Bratislava',
        weekStartsOn: 1,
      },
    },
  })

  // Create users
  const hashedPassword = await bcrypt.hash('demo123', 12)

  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@techcorp.sk',
      password: hashedPassword,
      name: 'Admin User',
      locale: 'sk',
      emailVerified: new Date(),
    },
  })

  const recruiterUser = await prisma.user.create({
    data: {
      email: 'recruiter@techcorp.sk',
      password: hashedPassword,
      name: 'Jana Nováková',
      locale: 'sk',
      emailVerified: new Date(),
    },
  })

  const hiringManager = await prisma.user.create({
    data: {
      email: 'hiring@techcorp.sk',
      password: hashedPassword,
      name: 'Peter Kováč',
      locale: 'sk',
      emailVerified: new Date(),
    },
  })

  const agencyUser = await prisma.user.create({
    data: {
      email: 'agency@partner.sk',
      password: hashedPassword,
      name: 'Agency Partner',
      locale: 'sk',
      emailVerified: new Date(),
    },
  })

  // Platform (global) admin — no org membership, reaches /admin
  await prisma.user.create({
    data: {
      email: 'superadmin@jobsphere.local',
      password: hashedPassword,
      name: 'Global Admin',
      locale: 'sk',
      emailVerified: new Date(),
      isGlobalAdmin: true,
    },
  })

  // Job-seeker (candidate) login: User + Candidate row linked via userId
  const candidateUser = await prisma.user.create({
    data: {
      email: 'candidate@jobsphere.local',
      password: hashedPassword,
      name: 'Test Kandidát',
      locale: 'sk',
      emailVerified: new Date(),
    },
  })
  await prisma.candidate.create({
    data: {
      orgId: org.id,
      userId: candidateUser.id,
      source: 'WEBSITE',
      tags: ['typescript', 'react'],
      contacts: {
        create: {
          fullName: 'Test Kandidát',
          email: 'candidate@jobsphere.local',
          location: 'Bratislava',
          primaryLocale: 'sk',
        },
      },
    },
  })

  // Freelancer login: User + FreelancerProfile
  const freelancerUser = await prisma.user.create({
    data: {
      email: 'freelancer@jobsphere.local',
      password: hashedPassword,
      name: 'Test Freelancer',
      locale: 'sk',
      emailVerified: new Date(),
    },
  })
  await prisma.freelancerProfile.create({
    data: {
      userId: freelancerUser.id,
      title: 'Web developer',
      bio: 'Testovací freelancer profil.',
      services: ['webdizajn', 'tvorba e-shopu'],
      skills: ['TypeScript', 'React'],
      hourlyRate: 30,
      location: 'Bratislava',
    },
  })

  // Assign roles
  await prisma.userOrgRole.createMany({
    data: [
      { userId: adminUser.id, orgId: org.id, role: 'ORG_ADMIN' },
      { userId: recruiterUser.id, orgId: org.id, role: 'RECRUITER' },
      { userId: hiringManager.id, orgId: org.id, role: 'HIRING_MANAGER' },
      { userId: agencyUser.id, orgId: org.id, role: 'AGENCY', assignedJobs: [] },
    ],
  })

  // Create products and plans for billing
  const starterProduct = await prisma.product.create({
    data: {
      name: 'Starter',
      description: 'Perfect for small teams',
      prices: {
        create: [
          {
            currency: 'EUR',
            amount: 4900,
            interval: 'MONTH',
            providerPriceId: 'price_starter_eur',
          },
          {
            currency: 'USD',
            amount: 5900,
            interval: 'MONTH',
            providerPriceId: 'price_starter_usd',
          },
        ],
      },
      plans: {
        create: {
          key: 'starter',
          name: 'Starter Plan',
          description: 'For small teams just getting started',
          features: {
            create: [
              { featureKey: 'job_slots', limitInt: 3 },
              { featureKey: 'seats', limitInt: 3 },
              { featureKey: 'assessments_per_month', limitInt: 1 },
              { featureKey: 'email_sends_per_month', limitInt: 500 },
            ],
          },
        },
      },
    },
  })

  const proProduct = await prisma.product.create({
    data: {
      name: 'Pro',
      description: 'For growing companies',
      prices: {
        create: [
          { currency: 'EUR', amount: 19900, interval: 'MONTH', providerPriceId: 'price_pro_eur' },
          { currency: 'USD', amount: 24900, interval: 'MONTH', providerPriceId: 'price_pro_usd' },
        ],
      },
      plans: {
        create: {
          key: 'pro',
          name: 'Pro Plan',
          description: 'For growing teams with more hiring needs',
          features: {
            create: [
              { featureKey: 'job_slots', limitInt: 15 },
              { featureKey: 'seats', limitInt: 10 },
              { featureKey: 'assessments_per_month', limitInt: 10 },
              { featureKey: 'email_sends_per_month', limitInt: 5000 },
            ],
          },
        },
      },
    },
  })

  const enterpriseProduct = await prisma.product.create({
    data: {
      name: 'Enterprise',
      description: 'Custom solution for large organizations',
      prices: {
        create: [
          {
            currency: 'EUR',
            amount: 99900,
            interval: 'MONTH',
            providerPriceId: 'price_enterprise_eur',
          },
        ],
      },
      plans: {
        create: {
          key: 'enterprise',
          name: 'Enterprise Plan',
          description: 'Unlimited everything with premium support',
          features: {
            create: [
              { featureKey: 'job_slots', limitInt: null },
              { featureKey: 'seats', limitInt: null },
              { featureKey: 'assessments_per_month', limitInt: null },
              { featureKey: 'email_sends_per_month', limitInt: null },
              { featureKey: 'sso', limitBool: true },
            ],
          },
        },
      },
    },
  })

  // Create subscription for demo org
  await prisma.subscription.create({
    data: {
      orgId: org.id,
      productId: proProduct.id,
      providerSubId: 'sub_demo_' + faker.string.alphanumeric(16),
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })

  // Create entitlements
  await prisma.entitlement.createMany({
    data: [
      { orgId: org.id, featureKey: 'job_slots', limitInt: 15, remainingInt: 12 },
      { orgId: org.id, featureKey: 'seats', limitInt: 10, remainingInt: 6 },
      { orgId: org.id, featureKey: 'assessments_per_month', limitInt: 10, remainingInt: 8 },
      { orgId: org.id, featureKey: 'email_sends_per_month', limitInt: 5000, remainingInt: 4500 },
      // Keys actually read by apps/web/src/lib/entitlements.ts (type `Feature`)
      { orgId: org.id, featureKey: 'MAX_JOBS', limitInt: 15 },
      { orgId: org.id, featureKey: 'MAX_CANDIDATES', limitInt: null },
      { orgId: org.id, featureKey: 'MAX_TEAM_MEMBERS', limitInt: 10 },
      { orgId: org.id, featureKey: 'EMAIL_SEQUENCES', limitInt: 1 },
      { orgId: org.id, featureKey: 'ASSESSMENTS', limitInt: 1 },
      { orgId: org.id, featureKey: 'AI_MATCHING', limitInt: 1 },
      { orgId: org.id, featureKey: 'CUSTOM_BRANDING', limitInt: 1 },
      { orgId: org.id, featureKey: 'API_ACCESS', limitInt: 1 },
    ],
  })

  // Create jobs in different regions
  const jobs = []
  for (const [regionCode, region] of Object.entries(REGIONS)) {
    for (let i = 0; i < 2; i++) {
      const city = faker.helpers.arrayElement(region.cities)
      const job = await prisma.job.create({
        data: {
          orgId: org.id,
          title: faker.helpers.arrayElement([
            'Senior Full Stack Developer',
            'DevOps Engineer',
            'Product Manager',
            'UX Designer',
            'Data Scientist',
            'QA Engineer',
          ]),
          description: faker.lorem.paragraphs(3),
          requirements: faker.lorem.paragraphs(2),
          responsibilities: faker.lorem.paragraphs(2),
          benefits: faker.lorem.paragraphs(1),
          city: city,
          region: regionCode,
          remote: regionCode === 'REMOTE',
          hybrid: faker.datatype.boolean(),
          employmentType: faker.helpers.arrayElement(['FULL_TIME', 'CONTRACT']),
          seniority: faker.helpers.arrayElement(['MID', 'SENIOR', 'LEAD']),
          salaryMin: faker.number.int({ min: 2000, max: 4000 }),
          salaryMax: faker.number.int({ min: 4000, max: 8000 }),
          salaryCurrency: 'EUR',
          salaryPeriod: 'MONTH',
          locale: faker.helpers.arrayElement(['sk', 'en']),
          status: faker.helpers.arrayElement(['PUBLISHED', 'PUBLISHED', 'DRAFT']),
          publishedAt: faker.date.recent({ days: 30 }),
          createdBy: recruiterUser.id,
          slug: faker.helpers.slugify(faker.lorem.words(3)),
        },
      })
      jobs.push(job)
    }
  }

  // Update agency user with assigned jobs
  await prisma.userOrgRole.update({
    where: { userId_orgId: { userId: agencyUser.id, orgId: org.id } },
    data: { assignedJobs: jobs.slice(0, 3).map((j) => j.id) },
  })

  // Create candidates with CVs
  for (let i = 0; i < 20; i++) {
    const candidate = await prisma.candidate.create({
      data: {
        orgId: org.id,
        source: faker.helpers.arrayElement(['WEBSITE', 'LINKEDIN', 'REFERRAL', 'IMPORT']),
        tags: faker.helpers.arrayElements(
          ['javascript', 'typescript', 'react', 'node', 'python', 'java'],
          3,
        ),
        contacts: {
          create: {
            fullName: faker.person.fullName(),
            email: faker.internet.email(),
            phone: faker.phone.number(),
            location: faker.helpers.arrayElement(Object.values(REGIONS).flatMap((r) => r.cities)),
            primaryLocale: faker.helpers.arrayElement(['sk', 'en', 'cs']),
            salaryExpectation: faker.number.int({ min: 2000, max: 6000 }),
          },
        },
      },
    })

    // Create resume with sections
    const skills = faker.helpers.arrayElements(
      [
        'JavaScript',
        'TypeScript',
        'React',
        'Node.js',
        'Python',
        'Java',
        'Docker',
        'Kubernetes',
        'AWS',
        'PostgreSQL',
        'MongoDB',
        'Redis',
      ],
      6,
    )

    const resume = await prisma.resume.create({
      data: {
        candidateId: candidate.id,
        language: faker.helpers.arrayElement(['sk', 'en']),
        summary: faker.lorem.paragraph(),
        yearsOfExperience: faker.number.float({ min: 1, max: 15, multipleOf: 0.5 }),
        skills: skills,
        personalInfo: {
          firstName: faker.person.firstName(),
          lastName: faker.person.lastName(),
          dateOfBirth: faker.date.birthdate({ min: 22, max: 55, mode: 'age' }),
        },
        experiences: Array.from({ length: faker.number.int({ min: 1, max: 4 }) }, () => ({
          title: faker.person.jobTitle(),
          company: faker.company.name(),
          location: faker.location.city(),
          startDate: faker.date.past({ years: 10 }),
          endDate: faker.datatype.boolean() ? faker.date.recent() : null,
          current: faker.datatype.boolean(),
          description: faker.lorem.paragraph(),
        })),
        education: Array.from({ length: faker.number.int({ min: 1, max: 2 }) }, () => ({
          degree: faker.helpers.arrayElement(['Bachelor', 'Master', 'PhD']),
          field: faker.helpers.arrayElement(['Computer Science', 'Engineering', 'Business']),
          school: faker.company.name() + ' University',
          location: faker.location.city(),
          startDate: faker.date.past({ years: 15 }),
          endDate: faker.date.past({ years: 10 }),
        })),
      },
    })

    // Create ResumeSection entities for semantic search
    // SUMMARY section
    await prisma.resumeSection.create({
      data: {
        resumeId: resume.id,
        kind: 'SUMMARY',
        text: resume.summary || faker.lorem.paragraph(),
        order: 0,
      },
    })

    // EXPERIENCE sections
    const experiences = resume.experiences as any[]
    for (let expIdx = 0; expIdx < experiences.length; expIdx++) {
      const exp = experiences[expIdx]
      await prisma.resumeSection.create({
        data: {
          resumeId: resume.id,
          kind: 'EXPERIENCE',
          title: exp.title,
          organization: exp.company,
          location: exp.location,
          startDate: new Date(exp.startDate),
          endDate: exp.endDate ? new Date(exp.endDate) : null,
          current: exp.current || false,
          text: exp.description,
          order: expIdx + 1,
        },
      })
    }

    // EDUCATION sections
    const education = resume.education as any[]
    for (let eduIdx = 0; eduIdx < education.length; eduIdx++) {
      const edu = education[eduIdx]
      await prisma.resumeSection.create({
        data: {
          resumeId: resume.id,
          kind: 'EDUCATION',
          title: `${edu.degree} in ${edu.field}`,
          organization: edu.school,
          location: edu.location,
          startDate: new Date(edu.startDate),
          endDate: new Date(edu.endDate),
          order: experiences.length + eduIdx + 1,
        },
      })
    }

    // SKILLS section
    await prisma.resumeSection.create({
      data: {
        resumeId: resume.id,
        kind: 'SKILLS',
        title: 'Technical Skills',
        text: skills.join(', '),
        json: { skills: skills },
        order: experiences.length + education.length + 1,
      },
    })

    // Create applications
    const numApplications = faker.number.int({ min: 0, max: 3 })
    const appliedJobs = faker.helpers.arrayElements(jobs, numApplications)

    for (const job of appliedJobs) {
      await prisma.application.create({
        data: {
          candidateId: candidate.id,
          jobId: job.id,
          orgId: org.id,
          stage: faker.helpers.arrayElement([
            'NEW',
            'SCREENING',
            'PHONE',
            'TECHNICAL',
            'ONSITE',
            'OFFER',
            'REJECTED',
          ]),
          score: faker.number.float({ min: 0, max: 100, multipleOf: 0.1 }),
          assignedTo: faker.helpers.arrayElement([recruiterUser.id, hiringManager.id, null]),
          source: faker.helpers.arrayElement(['WEBSITE', 'LINKEDIN', 'REFERRAL']),
          lastContactAt: faker.date.recent({ days: 7 }),
          tags: faker.helpers.arrayElements(['urgent', 'promising', 'follow-up', 'remote-only'], 2),
        },
      })

      // Create match score
      await prisma.matchScore.create({
        data: {
          orgId: org.id,
          jobId: job.id,
          candidateId: candidate.id,
          resumeId: resume.id,
          score0to100: faker.number.int({ min: 20, max: 95 }),
          bm25Score: faker.number.float({ min: 0, max: 1 }),
          vectorScore: faker.number.float({ min: 0, max: 1 }),
          llmScore: faker.number.float({ min: 0, max: 1 }),
          evidence: {
            matchedSkills: faker.helpers.arrayElements(['JavaScript', 'React', 'Node.js'], 2),
            experienceMatch: faker.datatype.boolean(),
            educationMatch: faker.datatype.boolean(),
          },
          explanation: [faker.lorem.sentence(), faker.lorem.sentence()],
          version: '1.0.0',
        },
      })
    }
  }

  // Create assessments
  const jsAssessment = await prisma.assessment.create({
    data: {
      orgId: org.id,
      name: 'Full Stack Developer Assessment',
      description: 'Technical assessment for full stack developers',
      locale: 'en',
      durationMin: 60,
      passingScore: 70,
      isPublished: true,
      createdBy: recruiterUser.id,
      sections: {
        create: [
          {
            title: 'JavaScript Fundamentals',
            order: 1,
            questions: {
              create: [
                {
                  type: 'MCQ',
                  text: 'What is the output of typeof null in JavaScript?',
                  choices: ['null', 'undefined', 'object', 'number'],
                  correctIndexes: [2],
                  points: 5,
                  skillTag: 'javascript',
                  order: 1,
                },
                {
                  type: 'MULTI_SELECT',
                  text: 'Which of the following are falsy values in JavaScript?',
                  choices: ['0', '""', 'null', '[]', 'false', '{}'],
                  correctIndexes: [0, 1, 2, 4],
                  points: 10,
                  skillTag: 'javascript',
                  order: 2,
                },
              ],
            },
          },
          {
            title: 'React Knowledge',
            order: 2,
            questions: {
              create: [
                {
                  type: 'SHORT_TEXT',
                  text: 'What is the purpose of useEffect hook in React?',
                  points: 10,
                  skillTag: 'react',
                  order: 1,
                },
                {
                  type: 'CODE',
                  text: 'Write a React component that fetches and displays user data',
                  language: 'javascript',
                  starterCode: '// Write your component here',
                  points: 20,
                  skillTag: 'react',
                  order: 2,
                },
              ],
            },
          },
        ],
      },
    },
  })

  const pythonAssessment = await prisma.assessment.create({
    data: {
      orgId: org.id,
      name: 'Python & SQL Developer Assessment',
      description: 'Technical assessment for backend and data engineering roles',
      locale: 'en',
      durationMin: 90,
      passingScore: 75,
      isPublished: true,
      createdBy: recruiterUser.id,
      sections: {
        create: [
          {
            title: 'Python Fundamentals',
            order: 1,
            questions: {
              create: [
                {
                  type: 'MCQ',
                  text: 'What is the difference between list and tuple in Python?',
                  choices: [
                    'Lists are mutable, tuples are immutable',
                    'Tuples are faster than lists',
                    'Lists use [], tuples use ()',
                    'All of the above',
                  ],
                  correctIndexes: [3],
                  points: 5,
                  skillTag: 'python',
                  order: 1,
                },
                {
                  type: 'CODE',
                  text: 'Write a Python function to find all prime numbers up to n using the Sieve of Eratosthenes',
                  language: 'python',
                  starterCode: 'def sieve_of_eratosthenes(n):\n    # Your code here\n    pass',
                  points: 15,
                  skillTag: 'python',
                  order: 2,
                },
              ],
            },
          },
          {
            title: 'SQL & Database Knowledge',
            order: 2,
            questions: {
              create: [
                {
                  type: 'SHORT_TEXT',
                  text: 'Explain the difference between INNER JOIN, LEFT JOIN, and RIGHT JOIN with examples.',
                  points: 10,
                  skillTag: 'sql',
                  order: 1,
                },
                {
                  type: 'CODE',
                  text: 'Write a SQL query to find the top 5 customers by total order value, including their name, email, and total spent.',
                  language: 'sql',
                  starterCode:
                    '-- Assume tables: customers (id, name, email) and orders (id, customer_id, total)\nSELECT\n  -- Your query here',
                  points: 15,
                  skillTag: 'sql',
                  order: 2,
                },
                {
                  type: 'MULTI_SELECT',
                  text: 'Which of the following are valid PostgreSQL data types?',
                  choices: ['VARCHAR', 'JSONB', 'BIGSERIAL', 'DATETIME', 'UUID', 'BLOB'],
                  correctIndexes: [0, 1, 2, 4],
                  points: 10,
                  skillTag: 'postgresql',
                  order: 3,
                },
              ],
            },
          },
          {
            title: 'Data Processing',
            order: 3,
            questions: {
              create: [
                {
                  type: 'CODE',
                  text: 'Write a Python script using pandas to read a CSV file, filter rows where age > 25, group by city, and calculate average salary.',
                  language: 'python',
                  starterCode: 'import pandas as pd\n\n# Your code here',
                  points: 20,
                  skillTag: 'pandas',
                  order: 1,
                },
              ],
            },
          },
        ],
      },
    },
  })

  // Create email sequences
  const followUpSequence = await prisma.emailSequence.create({
    data: {
      orgId: org.id,
      name: 'Candidate Follow-up Sequence',
      description: 'Automated follow-up for new candidates',
      active: true,
      createdBy: recruiterUser.id,
      settings: {
        quietHours: { start: 20, end: 8 },
        dailyLimit: 50,
        timezone: 'Europe/Bratislava',
      },
      steps: {
        create: [
          {
            name: 'Initial Welcome',
            dayOffset: 0,
            hourOffset: 9,
            subject: 'Welcome to {{company.name}}!',
            bodyTemplate:
              'Hi {{candidate.firstName}},\n\nThank you for applying to {{job.title}}...',
            order: 1,
          },
          {
            name: 'Follow-up',
            dayOffset: 3,
            hourOffset: 10,
            subject: 'Next steps in your application',
            bodyTemplate:
              'Hi {{candidate.firstName}},\n\nWe wanted to update you on your application...',
            order: 2,
          },
          {
            name: 'Check-in',
            dayOffset: 7,
            hourOffset: 14,
            subject: 'Are you still interested in {{job.title}}?',
            bodyTemplate: "Hi {{candidate.firstName}},\n\nWe haven't heard from you...",
            order: 3,
          },
        ],
      },
    },
  })

  const interviewSequence = await prisma.emailSequence.create({
    data: {
      orgId: org.id,
      name: 'Interview Invitation Sequence',
      description: 'Automated sequence for scheduling interviews with qualified candidates',
      active: true,
      createdBy: recruiterUser.id,
      settings: {
        quietHours: { start: 19, end: 8 },
        dailyLimit: 30,
        timezone: 'Europe/Bratislava',
      },
      steps: {
        create: [
          {
            name: 'Interview Invitation',
            dayOffset: 0,
            hourOffset: 10,
            subject: 'Interview Invitation - {{job.title}} at {{company.name}}',
            bodyTemplate: `Hi {{candidate.firstName}},

Congratulations! We were impressed with your application for the {{job.title}} position.

We would like to invite you for an interview to discuss your experience and learn more about your skills.

Interview Details:
- Position: {{job.title}}
- Format: {{interview.format}}
- Duration: {{interview.duration}} minutes

Please use the link below to schedule a time that works best for you:
{{scheduling.link}}

We look forward to speaking with you!

Best regards,
{{recruiter.name}}
{{company.name}} Recruitment Team`,
            order: 1,
          },
          {
            name: 'Interview Reminder',
            dayOffset: 1,
            hourOffset: 9,
            subject: 'Reminder: Schedule your interview for {{job.title}}',
            bodyTemplate: `Hi {{candidate.firstName}},

This is a friendly reminder to schedule your interview for the {{job.title}} position.

If you haven't already, please use the link below to pick a time:
{{scheduling.link}}

If you have any questions or need to reschedule, please don't hesitate to reach out.

Best regards,
{{recruiter.name}}`,
            order: 2,
          },
        ],
      },
    },
  })

  // Create email account (mock)
  await prisma.emailAccount.create({
    data: {
      orgId: org.id,
      provider: 'SMTP',
      email: 'hr@techcorp.sk',
      name: 'TechCorp HR',
      smtpHost: 'localhost',
      smtpPort: 1025,
      smtpUser: 'hr@techcorp.sk',
      smtpPass: 'demo',
      signature: '<p>Best regards,<br/>TechCorp HR Team</p>',
      isDefault: true,
    },
  })

  console.log('✅ Seed completed successfully!')
  console.log('')
  console.log('📊 Seeded Data Summary:')
  console.log('  Organizations: 1')
  console.log(
    '  Users: 7 (Admin, Recruiter, Hiring Manager, Agency, Global Admin, Candidate, Freelancer)',
  )
  console.log('  Jobs: 8 (across BA, ZA, KE, REMOTE regions)')
  console.log('  Candidates: 20 (with resumes and sections)')
  console.log('  Assessments: 2 (Full Stack JS/React, Python/SQL)')
  console.log('  Email Sequences: 2 (Follow-up, Interview Invitation)')
  console.log('')
  console.log('👤 Demo accounts:')
  console.log('  Admin: admin@techcorp.sk / demo123')
  console.log('  Recruiter: recruiter@techcorp.sk / demo123')
  console.log('  Hiring Manager: hiring@techcorp.sk / demo123')
  console.log('  Agency: agency@partner.sk / demo123')
  console.log('  Global Admin: superadmin@jobsphere.local / demo123')
  console.log('  Candidate: candidate@jobsphere.local / demo123')
  console.log('  Freelancer: freelancer@jobsphere.local / demo123')
}

seed()
  .catch((error) => {
    console.error('❌ Seed failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
