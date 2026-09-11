import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

type ServiceStatus = {
  slug: string;
  name: string;
  category: string;
  logo_url: string;
  status: string;
  report_count_1h: number;
  report_count_24h: number;
  updated_at: string;
};

export default function App() {
  const [serviceName, setServiceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<ServiceStatus | null>(null);

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('operational') || s.includes('up')) return '#28a745'; 
    if (s.includes('degraded') || s.includes('partial')) return '#f0ad4e'; 
    if (s.includes('down') || s.includes('major') || s.includes('outage')) return '#cb2431'; 
    return '#8a8f98'; 
  };

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  const checkStatus = async () => {
    if (!serviceName.trim()) return;

    Keyboard.dismiss(); 
    setLoading(true);
    setError(null);
    setStatusData(null);

    //Prueba de datos debido a la alta demanda de peticiones en la API pública (STATUS 429)
    const USE_MOCK = false; // Cambia a true para usar datos de prueba sin hacer fetch
    if (USE_MOCK) {
      setTimeout(() => {
        setStatusData({
          slug: 'github',
          name: 'GitHub',
          category: 'cloud',
          logo_url: 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://github.com&size=128',
          status: 'operational',
          report_count_1h: 0,
          report_count_24h: 0,
          updated_at: new Date().toISOString(),
        });
        setLoading(false);
      }, 800);
      return;
    }

    try {
      
      const query = serviceName.trim().toLowerCase();
      const response = await fetch(`https://isitdownstatus.com/api/v1/status/${query}`);

      console.log('STATUS:', response.status);

      if (response.status === 429) {
        throw new Error('Demasiadas solicitudes. Espera un momento antes de volver a intentar.');
      }

      if (!response.ok) {
        throw new Error('Servicio no encontrado o no monitoreado por esta API.');
      }

      const json = await response.json();

      if (!json.ok || !json.data) {
        throw new Error('No se encontró información para ese servicio.');
      }

      setStatusData(json.data);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Ocurrió un error desconocido');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Monitor de Servicios</Text>
        <Text style={styles.subtitle}>Consulta el status real de servicios de TI</Text>
      </View>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Ej: github, stripe, aws..."
          value={serviceName}
          onChangeText={setServiceName}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={checkStatus}
        />
        <TouchableOpacity style={styles.button} onPress={checkStatus}>
          <Text style={styles.buttonText}>Verificar</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.resultContainer} contentContainerStyle={styles.scrollContent}>
        {loading && <ActivityIndicator size="large" color="#0066cc" />}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Error: {error}</Text>
          </View>
        )}

        {statusData && (
          <View style={styles.card}>
            {/* Encabezado: logo + nombre + categoría */}
            <View style={styles.cardHeader}>
              {statusData.logo_url ? (
                <Image source={{ uri: statusData.logo_url }} style={styles.logo} />
              ) : null}
              <View style={styles.cardHeaderText}>
                <Text style={styles.cardTitle}>{statusData.name}</Text>
                <Text style={styles.cardCategory}>{statusData.category}</Text>
              </View>
            </View>

            {/* Semáforo: punto de color + texto del status */}
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: getStatusColor(statusData.status) }
                ]}
              />
              <Text style={styles.statusText}>{statusData.status}</Text>
            </View>

            {/* Datos extra */}
            <View style={styles.divider} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Reportes (última hora)</Text>
              <Text style={styles.detailValue}>{statusData.report_count_1h}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Reportes (24h)</Text>
              <Text style={styles.detailValue}>{statusData.report_count_24h}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Actualizado</Text>
              <Text style={styles.detailValue}>{formatDate(statusData.updated_at)}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e4e8',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#24292e',
  },
  subtitle: {
    fontSize: 14,
    color: '#586069',
    marginTop: 5,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 20,
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5da',
    borderRadius: 8,
    paddingHorizontal: 15,
    height: 50,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#0066cc',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 20,
    height: 50,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  resultContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 12,
  },
  cardHeaderText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#24292e',
    textTransform: 'capitalize',
  },
  cardCategory: {
    fontSize: 13,
    color: '#8a8f98',
    textTransform: 'capitalize',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    textTransform: 'capitalize',
    color: '#24292e',
  },
  divider: {
    height: 1,
    backgroundColor: '#e1e4e8',
    marginVertical: 10,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  detailLabel: {
    fontSize: 14,
    color: '#586069',
  },
  detailValue: {
    fontSize: 14,
    color: '#24292e',
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: '#ffeef0',
    borderColor: '#ffdce0',
    borderWidth: 1,
    padding: 15,
    borderRadius: 8,
  },
  errorText: {
    color: '#cb2431',
    fontWeight: '500',
  }
});
