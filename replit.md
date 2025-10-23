# Overview

This is a full-stack e-commerce application called "Phomas Online Store" built for PHOMAS DIAGNOSTICS, a medical supplier in Tanzania. The application has been successfully transformed from a demo system into a **real-time integrated platform** connected to their eCount ERP system. It features live product inventory, automated order processing, and administrative oversight with direct ERP connectivity.

## Integration Status ✅
- **eCount ERP Integration**: PRODUCTION API active (https://oapi{ZONE}.ecount.com)
- **Production Auth Key**: Using 1-year validity production credentials (01bfa323...eb59)
- **Live Authentication**: Zone-pinned session management with auto-retry
- **Hybrid Product Catalog**: 546 real products with 428 having mapped names from Excel
- **Order Processing**: Active production order submission to eCount SaveSaleOrder API
- **Proven Success**: Test orders #20251021-3 and #20251021-4 successfully submitted

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
The client is built with React 18 using TypeScript and follows a component-based architecture. The application uses Wouter for client-side routing and TanStack Query for state management and API calls. The UI is built with shadcn/ui components on top of Radix UI primitives, styled with Tailwind CSS using a custom design system with Phomas brand colors (#015a5a green, #007bff blue).

## Backend Architecture
The server is built with Express.js and uses an in-memory storage system for the demo. The backend implements a RESTful API with endpoints for authentication, product management, and order processing. The storage layer is abstracted through an interface (IStorage) to allow easy swapping between mock data and real API integration.

## Data Management
- **In-Memory Storage**: Uses Map-based storage for users, products, inventory, and orders during demo phase
- **Mock Data**: Sample data stored in JSON files within client/src/data directory
- **Database Schema**: Defined using Drizzle ORM with PostgreSQL schema for future database integration
- **Type Safety**: Full TypeScript coverage with shared types between client and server

## Authentication & Authorization
- **Supabase Authentication**: Production authentication using Supabase Auth
- **User Approval System**: ✅ NEW - All new registrations require admin approval before access
  - New users register with approved=false in Supabase user metadata
  - Login checks approval status and blocks unapproved users
  - WhatsApp integration (+255 678 389075) for approval requests
  - Admin panel "Pending Approvals" tab for reviewing and approving users
- Role-based access control (admin vs client users)
- Protected routes with authentication middleware
- Admin users (admin@phomas.com) bypass approval requirement

## State Management
- React Context API for authentication state and shopping cart
- TanStack Query for server state management and caching
- Local storage persistence for cart items and user sessions

## API Layer
- **Live eCount ERP Integration**: ✅ PRODUCTION environment (https://oapi{ZONE}.ecount.com)
- **Production Auth Key**: 01bfa323...eb59 (1-year validity, activated October 2025)
- **Zone-Pinned Sessions**: Solves zone/session mismatch with consistent API calls
- **Hybrid Data Strategy**: Local metadata merged with real-time ERP inventory
- **Centralized Request Handler**: JSON validation, auto-retry, and session management
- **Order Submission**: SaveSaleOrder API with customer 10839, warehouse 00001, VAT-inclusive
- **Critical Success**: IO_DATE="" allows eCount to auto-populate current date
- RESTful endpoints following standard HTTP conventions
- Consistent error handling and response formatting

## Build System
- Vite for frontend build tooling with React plugin
- ESBuild for server bundling in production
- TypeScript compilation with strict mode enabled
- Path mapping for clean imports (@/ aliases)

# External Dependencies

## UI Framework
- **React 18**: Core frontend framework
- **Radix UI**: Headless component primitives for accessibility
- **shadcn/ui**: Pre-built component library
- **Tailwind CSS**: Utility-first CSS framework
- **Lucide React**: Icon library

## State & Data Management
- **TanStack Query**: Server state management and caching
- **React Hook Form**: Form handling with validation
- **Zod**: Schema validation
- **date-fns**: Date manipulation utilities

## Backend & Database
- **Express.js**: Web application framework
- **Drizzle ORM**: Type-safe database toolkit
- **Neon Database**: PostgreSQL database service (via @neondatabase/serverless)
- **connect-pg-simple**: PostgreSQL session store

## Development Tools
- **Vite**: Build tool and development server
- **TypeScript**: Static type checking
- **ESLint**: Code linting
- **PostCSS**: CSS processing with Autoprefixer

## Routing & Navigation
- **Wouter**: Lightweight client-side routing

## Active Integrations
- **eCount ERP**: ✅ LIVE in production environment
  - Production API: https://oapi{ZONE}.ecount.com
  - Auth Key: 01bfa323...eb59 (valid until October 2026)
  - Features: Real-time inventory sync, automated order submission
  - Customer Code: 10839 "Online Store Sales"
  - Warehouse: 00001
  - Proven working with successful test orders

- **Cloudinary**: ✅ Direct upload integration for product images
  - Cloud Name: dvrdcyymo
  - Upload Preset: PHOMAS (configured in environment variable)
  - Frontend uploads directly to Cloudinary without server proxy
  - Automatic image optimization and transformation
  - Storage: phomas-products folder with 800x600 limit, auto quality/format

## UI Enhancements
- **Password Visibility Toggle**: Login and registration forms include Eye/EyeOff icons for password viewing
- **User Approval Workflow**: 
  - Registration success page with pending approval message
  - WhatsApp quick-contact button for faster approval
  - Login blocked for unapproved users with helpful messaging
  - Admin panel tab for viewing and approving pending registrations
- **Low-Stock Indicators**: Visible only to admin users (hidden from customers)
- **Responsive Design**: Full mobile and desktop support with Tailwind CSS
- **Dark Mode Ready**: Theme infrastructure in place using shadcn/ui theming

# Recent Changes (October 2025)

## User Approval System Implementation
- **Registration Flow**: New users see pending approval message after successful registration
- **Login Protection**: Unapproved users cannot login and receive WhatsApp contact info
- **Admin Management**: New "Pending Approvals" tab in admin panel shows:
  - User details (company name, email, phone, address, registration date)
  - One-click approval button
  - WhatsApp contact link for each user
- **Backend API**: 
  - GET /api/admin/pending-users - Lists users awaiting approval
  - POST /api/admin/approve-user/:userId - Approves a user
  - Approval status stored in Supabase user metadata (approved field)
- **WhatsApp Integration**: Contact number +255 678 389075 for approval requests
- **Bug Fix**: Fixed admin token authorization issue where apiRequest wasn't checking for `phomas_admin_token` in localStorage