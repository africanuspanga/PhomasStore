# Overview

This is a full-stack e-commerce application called "Phomas Online Store" built as a demo system for medical supply ordering. The application serves as a high-fidelity prototype that mirrors a real medical supply store interface, designed to be easily integrated with the eCOUNT API system once credentials are provided. It features a complete product catalog, shopping cart functionality, order management, and admin panel for inventory oversight.

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
- Session-based authentication with localStorage persistence
- Role-based access control (admin vs client users)
- Password-based login (note: passwords are stored in plain text for demo purposes)
- Protected routes with authentication middleware

## State Management
- React Context API for authentication state and shopping cart
- TanStack Query for server state management and caching
- Local storage persistence for cart items and user sessions

## API Layer
- Service layer abstraction (ecountService) designed for easy eCOUNT API integration
- RESTful endpoints following standard HTTP conventions
- Consistent error handling and response formatting
- Request/response logging middleware

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

## Future Integration
- **eCOUNT API**: Enterprise resource planning system (configured but not active)
- The application is architecturally prepared for eCOUNT integration through the service layer abstraction