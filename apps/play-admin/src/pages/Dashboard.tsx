import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { useAuth } from '../auth/AuthContext'

export default function Dashboard() {
  const { user } = useAuth()
  return (
    <div className="p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bienvenue {user?.name || user?.email}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Utilisez la navigation pour gérer les contenus et les utilisateurs.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

