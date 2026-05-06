import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectRouteRedirect,
})

function ProjectRouteRedirect() {
  const { projectId } = Route.useParams()

  // Project settings are handled via the edit dialog on /projects/.
  return <Navigate to="/editor/$projectId" params={{ projectId }} replace />
}
