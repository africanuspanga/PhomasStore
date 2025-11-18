# Overview

Phomas Online Store is a full-stack e-commerce application for PHOMAS DIAGNOSTICS, a medical supplier. It has been transformed into a real-time integrated platform connected to their eCount ERP system, featuring live product inventory, automated order processing, and administrative oversight. The system has active production API integration with eCount for authentication and order submission.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
The client is built with React 18, TypeScript, Wouter for routing, and TanStack Query for state management. UI components are from shadcn/ui built on Radix UI primitives, styled with Tailwind CSS using Phomas brand colors.

## Backend Architecture
The server uses Express.js with a RESTful API for authentication, product, and order management. It uses an in-memory storage for development, abstracting the storage layer with an `IStorage` interface.

## Data Management
In-memory storage is used for demo purposes. Mock data is stored in JSON files. Drizzle ORM defines the PostgreSQL schema for future integration, and TypeScript provides full type safety across client and server.

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
- **Neon Database**
- **connect-pg-simple**

## Development Tools
- **Vite**
- **TypeScript**
- **ESLint**
- **PostCSS**

## Routing & Navigation
- **Wouter**

## Active Integrations
- **eCount ERP**: Live production integration for inventory and order submission (https://oapi{ZONE}.ecount.com). Auth Key: 01bfa323...eb59. Customer Code: 10839, Warehouse: 00001.
- **Supabase**: For user authentication and authorization.
- **Cloudinary**: Direct image uploads for product images (Cloud Name: dvrdcyymo, Upload Preset: PHOMAS).