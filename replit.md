# Overview

Phomas Online Store is a full-stack e-commerce application for PHOMAS DIAGNOSTICS, a medical supplier. It has been transformed into a real-time integrated platform connected to their eCount ERP system, featuring live product inventory, automated order processing, and administrative oversight. The system has active production API integration with eCount for authentication and order submission.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
The client is built with React 18, TypeScript, Wouter for routing, and TanStack Query for state management. UI components are from shadcn/ui built on Radix UI primitives, styled with Tailwind CSS using Phomas brand colors.

## Backend Architecture
The server uses Express.js with a RESTful API for authentication, product, and order management. It uses Supabase PostgreSQL for persistent order storage and an in-memory cache for products (sourced from eCount ERP), abstracting the storage layer with an `IStorage` interface.

## Data Management
**Production database**: Supabase PostgreSQL (eu-north-1 region) via Transaction Pooler for persistent order storage, user profiles, and product images. Products and inventory are fetched in real-time from eCount ERP. Drizzle ORM with postgres.js provides type-safe database queries. TypeScript ensures full type safety across client and server.

## Authentication & Authorization
Production authentication uses Supabase Auth. A user approval system requires admin approval for all new registrations, with unapproved users blocked from login. Role-based access control (admin vs. client) is implemented with protected routes. Admin users (admin@phomas.com) bypass the approval process.

## State Management
React Context API manages authentication and shopping cart state. TanStack Query handles server state and caching. Local storage persists cart items and user sessions.

## API Layer
Live integration with eCount ERP production environment. It uses a hybrid data strategy, merging local metadata with real-time ERP inventory. A centralized request handler manages JSON validation, auto-retry, and zone-pinned session management. Order submission uses the `SaveSaleOrder` API with VAT-inclusive pricing. Enterprise-grade error tracking prevents eCount API lockouts with consecutive error counters, configurable thresholds, auto-lock mechanisms, and circuit breakers. An Excel fallback system ensures operational continuity when the eCount InventoryBalance API is unavailable.

## Build System
Vite is used for frontend builds, ESBuild for server bundling, and TypeScript for compilation with strict mode. Path mapping is configured for clean imports.

## UI/UX Decisions
The application features a responsive design for mobile and desktop, a password visibility toggle on forms, low-stock indicators visible only to admins, and a dark mode ready theme infrastructure. The user approval workflow includes a pending approval message post-registration, login blocking for unapproved users, and an admin panel for managing approvals. Registration requires company details like Company Registration Number and TIN. An order management system tracks customer orders and provides order history for users and detailed views for admins. A product search feature is available in the Admin Panel for real-time filtering.

## Feature Specifications
- **Real-time Product Inventory**: Integrated with eCount ERP.
- **Automated Order Processing**: Direct submission to eCount's `SaveSaleOrder` API.
- **User Approval System**: New users require admin approval to access the store.
- **Customer Order Tracking**: Comprehensive system to track customer orders and history.
- **Admin Panel**: Tools for product management, order oversight, and user approval.
- **Product Search**: Admin panel search for products by various attributes.
- **API Lockout Prevention**: Robust error handling to prevent eCount API bans.
- **Excel Fallback**: Ensures product display even if real-time inventory API is down.
- **Cloudinary Integration**: Direct image uploads and optimization.
- **Keep-Alive System**: Self-ping every 3 minutes via `/api/health` endpoint to prevent app sleeping.

# External Dependencies

## UI Framework
- **React 18**
- **Radix UI**
- **shadcn/ui**
- **Tailwind CSS**
- **Lucide React**

## State & Data Management
- **TanStack Query**
- **React Hook Form**
- **Zod**
- **date-fns**

## Backend & Database
- **Express.js**
- **Drizzle ORM**
- **Supabase PostgreSQL** (Transaction Pooler, eu-north-1)
- **postgres.js** (database driver)

## Development Tools
- **Vite**
- **TypeScript**
- **ESLint**
- **PostCSS**

## Routing & Navigation
- **Wouter**

## Active Integrations
- **eCount ERP**: Live production integration for inventory and order submission (https://oapi{ZONE}.ecount.com). Auth Key: 01bfa323...eb59. Customer Code: 10839, Warehouse: 00001.
- **Supabase PostgreSQL**: Production database for persistent order storage (eu-north-1 region, Transaction Pooler on port 6543). Also handles user authentication, product images, and profiles.
- **Cloudinary**: Direct image uploads for product images (Cloud Name: dvrdcyymo, Upload Preset: PHOMAS).

# Recent Changes (November 18, 2025)

## ✅ Supabase PostgreSQL Integration Completed
Successfully migrated from in-memory storage to Supabase PostgreSQL for persistent order storage:
- **Connection**: Transaction Pooler (IPv4-compatible, port 6543) in eu-north-1 region
- **Connection String**: `postgresql://postgres.xvomxojbfhovbhbbkuoh:[encoded-password]@aws-1-eu-north-1.pooler.supabase.com:6543/postgres`
- **Database Driver**: postgres.js with Drizzle ORM
- **Password Encoding**: Special characters (@, #) URL-encoded for proper authentication
- **Schema**: All tables created (orders, users, profiles, products, inventory, product_images)
- **Status**: ✅ Connected and operational
- **Order Persistence**: All new customer orders saved permanently to Supabase database
- **Admin Dashboard**: Displays all orders with real-time data from database
- **Fix Applied**: Added `encodeURIComponent()` to handle special characters in database password
